/**
 * /invite/[token] — public invitation page.
 *
 * Anon-readable. The trip's share_token gates access — no login
 * required to view. This is the high-leverage public surface in
 * Phase A; build guide §6 Step 4.
 *
 * The trip's `theme` field drives the visual treatment of EVERY
 * surface here, not just the cover. See /web/lib/themes.ts for
 * the per-theme class bundle.
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
import { themeClass, type ThemeStyle } from "@/lib/themes";

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
  const t = themeClass(trip.theme);

  return (
    <main className={`min-h-dvh ${t.root}`}>
      <div className="max-w-2xl mx-auto px-5 sm:px-8 py-10">
        {/* ─── Cover ──────────────────────────────────── */}
        {trip.cover_image_url ? (
          <div
            className={`aspect-[16/10] w-full rounded-[28px] mb-8 bg-cover bg-center ${t.cover}`}
            style={{ backgroundImage: `url(${escapeCss(trip.cover_image_url)})` }}
            aria-hidden="true"
          />
        ) : (
          <div className={`aspect-[16/10] w-full rounded-[28px] mb-8 ${t.cover}`}>
            <div className="h-full flex items-center justify-center px-6">
              <span className={`text-3xl sm:text-4xl text-center ${t.coverInk}`}>
                {trip.name}
              </span>
            </div>
          </div>
        )}

        {/* ─── Header ─────────────────────────────────── */}
        <p className={`text-[11px] mb-3 ${t.eyebrow}`}>
          {t.label} · You&apos;re invited
        </p>
        <h1 className={`text-4xl sm:text-5xl leading-[1.05] mb-3 ${t.display}`}>
          {trip.name}
        </h1>
        {trip.destination && (
          <p className={`text-lg mb-1 ${t.body}`}>{trip.destination}</p>
        )}
        {(trip.start_date || trip.end_date) && (
          <p className={`mb-6 ${t.meta}`}>
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
            <div className={`h-10 w-10 rounded-full flex items-center justify-center font-bold ${t.accent}`}>
              {plannerName.charAt(0).toUpperCase()}
            </div>
          )}
          <div>
            <p className={`text-xs uppercase tracking-widest font-semibold ${t.meta}`}>
              Hosted by
            </p>
            <p className={`font-semibold ${t.body}`}>{plannerName}</p>
          </div>
        </div>

        {/* ─── Description ───────────────────────────── */}
        {trip.description && (
          <p className={`mb-8 max-w-prose whitespace-pre-line leading-relaxed ${t.body}`}>
            {trip.description}
          </p>
        )}

        {/* ─── Cost-per-person estimate ──────────────── */}
        {(trip.budget_min != null || trip.budget_max != null) && (
          <div className={`${t.surface} border ${t.surfaceBorder} rounded-[18px] p-4 mb-8`}>
            <p className={`text-xs uppercase tracking-widest font-semibold mb-1 ${t.meta}`}>
              Ballpark per person
            </p>
            <p className={`font-semibold text-lg ${t.body}`}>
              {formatBudget(trip.budget_min, trip.budget_max)}
            </p>
            <p className={`text-sm ${t.meta}`}>
              Includes everything — flights, lodging, food, fun.
            </p>
          </div>
        )}

        {/* ─── RSVP buttons ──────────────────────────── */}
        <RsvpButtons tripId={trip.id} shareToken={trip.share_token} />

        {/* ─── Guest list ─────────────────────────────── */}
        <section className="mt-12">
          <h2 className={`text-2xl mb-4 ${t.display}`}>
            The crew · {respondents.length}
          </h2>
          <GuestRoster buckets={buckets} t={t} />
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
  t,
}: {
  buckets: Record<RsvpStatus | "invited", Respondent[]>;
  t: ThemeStyle;
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
            <p className={`text-xs uppercase tracking-widest font-semibold mb-2 ${t.meta}`}>
              {labels[status]} · {rs.length}
            </p>
            <div className="flex flex-wrap gap-2">
              {rs.map((r) => (
                <div
                  key={r.id}
                  className={`flex items-center gap-2 ${t.surface} border ${t.surfaceBorder} rounded-full pl-1 pr-3 py-1`}
                >
                  <div className={`h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold ${t.accent}`}>
                    {r.name.charAt(0).toUpperCase()}
                  </div>
                  <span className={`text-sm ${t.body}`}>{r.name}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
      {Object.values(buckets).every((b) => b.length === 0) && (
        <p className={`text-sm ${t.meta}`}>
          No one invited yet. The list will fill in as the planner sends invitations.
        </p>
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
  return url.replace(/[()'"\\]/g, "\\$&");
}
