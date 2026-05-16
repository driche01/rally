/**
 * GET /api/calendar/[token].ics — public ICS feed scoped to one user.
 *
 * The `token` is profiles.calendar_token (uuid). Anyone with the
 * token can subscribe to the feed, which is how the user adds it
 * to Google Calendar / Apple Calendar without OAuth. Tokens are
 * unguessable but not secret-grade — rotatable from Settings later.
 *
 * Filtering: the three calendar_include_{going,maybe,invited}
 * booleans on profiles drive which RSVPs surface. Hosted /
 * cohosted trips always appear.
 *
 * Routing note: Next.js doesn't let us put a `.ics` literal in the
 * dynamic-segment name, so we accept the trailing extension via a
 * regex strip. Subscribe URL exposed to users:
 *   /api/calendar/<token>.ics
 * which Next resolves to params.token = "<token>.ics" — we trim
 * the suffix here.
 */

import { createServiceClient } from "@/lib/supabase/server";
import type { Trip } from "@shared/types";

interface CalProfile {
  id: string;
  name: string;
  last_name: string | null;
  calendar_token: string;
  calendar_include_going:   boolean;
  calendar_include_maybe:   boolean;
  calendar_include_invited: boolean;
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ token: string }> },
) {
  const { token: raw } = await ctx.params;
  const token = raw.replace(/\.ics$/i, "");
  if (!isUuid(token)) {
    return new Response("invalid token", { status: 400 });
  }

  const svc = createServiceClient();
  const { data: profile } = await svc
    .from("profiles")
    .select("id, name, last_name, calendar_token, calendar_include_going, calendar_include_maybe, calendar_include_invited")
    .eq("calendar_token", token)
    .maybeSingle();
  if (!profile) {
    return new Response("not found", { status: 404 });
  }
  const p = profile as CalProfile;

  // Mirror /trips/page.tsx: union of hosted + cohosted + invitee
  // trips, deduped, then RSVP-filtered.
  const phone = await resolvePhone(svc, p.id);
  const usersId = phone ? await resolveUsersId(svc, phone) : null;

  const [hosted, cohosted, invitedById, invitedByPhone] = await Promise.all([
    svc.from("trips").select("*").eq("created_by", p.id),
    svc.from("trip_cohosts").select("trips:trips!inner(*)").eq("user_id", p.id),
    usersId
      ? svc.from("respondents").select("rsvp_status, trips:trips!inner(*)").eq("user_id", usersId)
      : Promise.resolve({ data: [] as unknown[] }),
    phone
      ? svc.from("respondents").select("rsvp_status, trips:trips!inner(*)").eq("phone", phone)
      : Promise.resolve({ data: [] as unknown[] }),
  ]);

  const seen = new Map<string, { trip: Trip; rsvp: string | null; isHostish: boolean }>();
  for (const t of (hosted.data ?? []) as Trip[]) {
    seen.set(t.id, { trip: t, rsvp: "going", isHostish: true });
  }
  for (const row of (cohosted.data ?? []) as unknown as { trips: Trip | Trip[] | null }[]) {
    const trip = Array.isArray(row.trips) ? row.trips[0] : row.trips;
    if (trip && !seen.has(trip.id)) seen.set(trip.id, { trip, rsvp: "going", isHostish: true });
  }
  for (const row of [
    ...((invitedById.data ?? []) as unknown as { trips: Trip | Trip[] | null; rsvp_status: string | null }[]),
    ...((invitedByPhone.data ?? []) as unknown as { trips: Trip | Trip[] | null; rsvp_status: string | null }[]),
  ]) {
    const trip = Array.isArray(row.trips) ? row.trips[0] : row.trips;
    if (!trip || seen.has(trip.id)) continue;
    seen.set(trip.id, { trip, rsvp: row.rsvp_status ?? "invited", isHostish: false });
  }

  const eligible = Array.from(seen.values()).filter(({ trip, rsvp, isHostish }) => {
    if (trip.cancelled_at) return false;
    if (!trip.start_date)  return false; // no dates → can't render an event
    if (isHostish) return true;
    if (rsvp === "going")   return p.calendar_include_going;
    if (rsvp === "maybe")   return p.calendar_include_maybe;
    if (rsvp === "invited") return p.calendar_include_invited;
    return false; // cant_go: never include
  });

  // Build ICS.
  const baseUrl = await siteBase();
  const calName = displayName(p.name, p.last_name)
    ? `Rally · ${displayName(p.name, p.last_name)}`
    : "Rally";

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Rally//Trips Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcs(calName)}`,
    "X-WR-TIMEZONE:UTC",
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];

  for (const { trip, rsvp, isHostish } of eligible) {
    const startISO = isoDateBasic(trip.start_date!);
    // ICS DTEND for all-day events is exclusive — bump by 1 day.
    const endSource = trip.end_date ?? trip.start_date!;
    const endISO = isoDateBasic(addDays(endSource, 1));
    const summary = trip.name;
    const statusTag = isHostish ? "(host)" : rsvp ? `(${rsvp.replace(/_/g, " ")})` : "";
    // Join with raw newlines; escapeIcs will turn them into RFC5545
    // literal "\n" sequences (a single backslash + n in the wire
    // format — calendar apps render that as a line break).
    const description = [
      trip.destination ? `Destination: ${trip.destination}` : null,
      trip.description ? trip.description : null,
      statusTag ? `Status: ${statusTag.replace(/[()]/g, "")}` : null,
      `View: ${baseUrl}/trips/${trip.id}`,
    ].filter(Boolean).join("\n");
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:trip-${trip.id}@rally`);
    lines.push(`DTSTAMP:${nowStamp()}`);
    lines.push(`DTSTART;VALUE=DATE:${startISO}`);
    lines.push(`DTEND;VALUE=DATE:${endISO}`);
    lines.push(`SUMMARY:${escapeIcs(summary)}${statusTag ? " " + escapeIcs(statusTag) : ""}`);
    lines.push(`DESCRIPTION:${escapeIcs(description)}`);
    if (trip.destination) lines.push(`LOCATION:${escapeIcs(trip.destination)}`);
    lines.push(`URL:${baseUrl}/trips/${trip.id}`);
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");

  // CRLF per RFC 5545.
  const body = lines.join("\r\n") + "\r\n";
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": 'text/calendar; charset=utf-8',
      "Cache-Control": "public, max-age=300", // 5 min — calendar clients still poll on their own cadence
    },
  });
}

// ─── Helpers ──────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(s: string): boolean { return UUID_RE.test(s); }

async function resolvePhone(svc: ReturnType<typeof createServiceClient>, profileId: string): Promise<string | null> {
  const { data } = await svc.from("profiles").select("phone").eq("id", profileId).maybeSingle();
  return data?.phone ?? null;
}

async function resolveUsersId(svc: ReturnType<typeof createServiceClient>, phone: string): Promise<string | null> {
  const { data } = await svc.from("users").select("id").eq("phone", phone).maybeSingle();
  return data?.id ?? null;
}

function displayName(name: string, lastName: string | null): string {
  return lastName ? `${name} ${lastName}` : name;
}

function isoDateBasic(iso: string): string {
  // 2026-05-20 → 20260520
  return iso.replace(/-/g, "");
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function nowStamp(): string {
  // RFC5545 DTSTAMP — UTC basic form YYYYMMDDTHHMMSSZ
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function escapeIcs(s: string): string {
  // RFC5545: backslash, semicolon, comma, newline get escaped.
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

async function siteBase(): Promise<string> {
  try {
    const { getSiteUrl } = await import("@/lib/site-url");
    return await getSiteUrl();
  } catch {
    return "https://rally";
  }
}
