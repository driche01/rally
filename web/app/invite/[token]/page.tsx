/**
 * /invite/[token] — public invitation page.
 *
 * Anon-readable. The trip's share_token gates access — no login
 * required to view. This is the high-leverage public surface in
 * Phase A; build guide §6 Step 4.
 *
 * Why service-role for the planner read: anon can't SELECT
 * profiles (no policy permits it), but we need the planner's name
 * + avatar for the "Hosted by" line. Service-role bypasses RLS;
 * we whitelist columns to public ones only (no email / no phone).
 */

import { notFound } from "next/navigation";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import type {
  Trip, Respondent, ActivityFeedEntry, RsvpStatus,
} from "@shared/types";
import RsvpButtons from "./rsvp-buttons";
import ActivitySection from "./activity-section";
import { themeClass } from "./themes";

interface PageProps {
  params: Promise<{ token: string }>;
}

export default async function InvitePage({ params }: PageProps) {
  const { token } = await params;

  const anon = await createClient();

  // 1. Trip by share token (anon-allowed per existing RLS).
  const { data: tripRow } = await anon
    .from("trips")
    .select("*")
    .eq("share_token", token)
    .maybeSingle();

  if (!tripRow) notFound();
  const trip = tripRow as Trip;

  // 2. Planner profile via service-role, public fields only.
  //    NOTE: this is the one place we deliberately bypass RLS in
  //    Phase A. Whitelist: name, last_name, avatar_url. Nothing
  //    sensitive in the SELECT.
  let plannerName = "A friend";
  let plannerAvatar: string | null = null;
  if (trip.created_by) {
    const svc = createServiceClient();
    const { data: planner } = await svc
      .from("profiles")
      .select("name, last_name, avatar_url")
      .eq("id", trip.created_by)
      .maybeSingle();
    if (planner) {
      plannerName = planner.last_name
        ? `${planner.name} ${planner.last_name}`
        : planner.name;
      plannerAvatar = planner.avatar_url;
    }
  }

  // 3. Respondents + activity feed in parallel (anon-allowed).
  const [respondentsRes, activityRes] = await Promise.all([
    anon.from("respondents").select("*").eq("trip_id", trip.id),
    anon
      .from("activity_feed_entries")
      .select("*")
      .eq("trip_id", trip.id)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);
  const respondents = (respondentsRes.data ?? []) as Respondent[];
  const activity = (activityRes.data ?? []) as ActivityFeedEntry[];

  const buckets = bucketByStatus(respondents);
  const themeCls = themeClass(trip.theme);

  return (
    <main className={`min-h-dvh ${themeCls.root}`}>
      <div className="max-w-2xl mx-auto px-5 sm:px-8 py-10">
        {/* ─── Cover ──────────────────────────────────── */}
        {trip.cover_image_url ? (
          <div
            className="aspect-[16/10] w-full rounded-[28px] bg-cream-2 mb-8 bg-cover bg-center"
            style={{ backgroundImage: `url(${escapeCss(trip.cover_image_url)})` }}
            aria-hidden="true"
          />
        ) : (
          <div className={`aspect-[16/10] w-full rounded-[28px] mb-8 ${themeCls.cover}`}>
            <div className="h-full flex items-center justify-center">
              <span className={`font-display text-3xl ${themeCls.coverInk}`}>
                {trip.name}
              </span>
            </div>
          </div>
        )}

        {/* ─── Header ─────────────────────────────────── */}
        <p className={`text-xs font-bold tracking-widest uppercase mb-3 ${themeCls.eyebrow}`}>
          {themeCls.label} · You&apos;re invited
        </p>
        <h1 className="font-display text-4xl sm:text-5xl leading-[1.05] text-ink mb-3">
          {trip.name}
        </h1>
        {trip.destination && (
          <p className="text-ink/85 text-lg mb-1">{trip.destination}</p>
        )}
        {(trip.start_date || trip.end_date) && (
          <p className="text-muted mb-6">
            {formatDateRange(trip.start_date, trip.end_date)}
          </p>
        )}

        {/* ─── Hosted by ──────────────────────────────── */}
        <div className="flex items-center gap-3 mb-8">
          {plannerAvatar ? (
            <img
              src={plannerAvatar}
              alt=""
              className="h-10 w-10 rounded-full object-cover"
            />
          ) : (
            <div className="h-10 w-10 rounded-full bg-green-soft text-green flex items-center justify-center font-bold">
              {plannerName.charAt(0).toUpperCase()}
            </div>
          )}
          <div>
            <p className="text-xs uppercase tracking-widest text-muted font-semibold">
              Hosted by
            </p>
            <p className="text-ink font-semibold">{plannerName}</p>
          </div>
        </div>

        {/* ─── Description ───────────────────────────── */}
        {trip.description && (
          <p className="text-ink/90 mb-8 max-w-prose whitespace-pre-line leading-relaxed">
            {trip.description}
          </p>
        )}

        {/* ─── Cost-per-person estimate ──────────────── */}
        {(trip.budget_min != null || trip.budget_max != null) && (
          <div className="bg-card border border-line rounded-[18px] p-4 mb-8">
            <p className="text-xs uppercase tracking-widest text-muted font-semibold mb-1">
              Ballpark per person
            </p>
            <p className="text-ink font-semibold text-lg">
              {formatBudget(trip.budget_min, trip.budget_max)}
            </p>
            <p className="text-muted text-sm">
              Includes everything — flights, lodging, food, fun.
            </p>
          </div>
        )}

        {/* ─── RSVP buttons (wired in Step 5) ──────────── */}
        <RsvpButtons tripId={trip.id} shareToken={trip.share_token} />

        {/* ─── Guest list ─────────────────────────────── */}
        <section className="mt-12">
          <h2 className="font-display text-2xl text-ink mb-4">
            The crew · {respondents.length}
          </h2>
          <GuestRoster buckets={buckets} />
        </section>

        {/* ─── Activity feed (composer + realtime) ────── */}
        <ActivitySection
          tripId={trip.id}
          shareToken={trip.share_token}
          initial={activity}
        />
      </div>
    </main>
  );
}

// ─── Sub-components ───────────────────────────────────────────────

function GuestRoster({
  buckets,
}: {
  buckets: Record<RsvpStatus | "invited", Respondent[]>;
}) {
  const order: (RsvpStatus | "invited")[] = ["going", "maybe", "invited", "cant_go"];
  const labels: Record<RsvpStatus | "invited", string> = {
    going:   "Going",
    maybe:   "Maybe",
    invited: "Invited",
    cant_go: "Can't make it",
  };

  return (
    <div className="grid gap-5">
      {order.map((status) => {
        const rs = buckets[status];
        if (!rs.length) return null;
        return (
          <div key={status}>
            <p className="text-xs uppercase tracking-widest text-muted font-semibold mb-2">
              {labels[status]} · {rs.length}
            </p>
            <div className="flex flex-wrap gap-2">
              {rs.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center gap-2 bg-card border border-line rounded-full pl-1 pr-3 py-1"
                >
                  <div className="h-7 w-7 rounded-full bg-green-soft text-green flex items-center justify-center text-xs font-bold">
                    {r.name.charAt(0).toUpperCase()}
                  </div>
                  <span className="text-sm text-ink">{r.name}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
      {Object.values(buckets).every((b) => b.length === 0) && (
        <p className="text-muted text-sm">No one invited yet. The list will fill in as the planner sends invitations.</p>
      )}
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────

function bucketByStatus(
  rs: Respondent[],
): Record<RsvpStatus | "invited", Respondent[]> {
  const out: Record<RsvpStatus | "invited", Respondent[]> = {
    going: [], maybe: [], invited: [], cant_go: [],
  };
  for (const r of rs) {
    const k = (r.rsvp_status ?? "invited") as RsvpStatus | "invited";
    if (out[k]) out[k].push(r);
  }
  return out;
}

function formatDateRange(start: string | null, end: string | null): string {
  const fmt = (s: string) =>
    new Date(s + "T00:00:00").toLocaleDateString("en-US", {
      month: "short", day: "numeric",
    });
  if (start && end) {
    const startY = new Date(start + "T00:00:00").getFullYear();
    return `${fmt(start)} → ${fmt(end)}, ${startY}`;
  }
  if (start) return `From ${fmt(start)}`;
  if (end)   return `Until ${fmt(end)}`;
  return "Dates TBD";
}

function formatBudget(min: number | null, max: number | null): string {
  if (min != null && max != null) return `$${min.toLocaleString()} – $${max.toLocaleString()}`;
  if (min != null) return `From $${min.toLocaleString()}`;
  if (max != null) return `Up to $${max.toLocaleString()}`;
  return "TBD";
}

function escapeCss(url: string): string {
  // CSS url() value-position escape. We pass through https URLs without
  // letting a quote or paren break the rule. Belt-and-suspenders; the
  // input is user-supplied (planner-set cover_image_url).
  return url.replace(/[()'"\\]/g, "\\$&");
}
