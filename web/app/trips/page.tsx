/**
 * /trips — post-login dashboard.
 *
 * Partiful-style index: a "Welcome back, name!" greeting, pill
 * filters across the top (Upcoming / Invites / Hosting / Attended /
 * All past / Search), and a grid of theme-aware trip cards.
 *
 * Data model — the visitor relates to a trip via three possible
 * paths, any of which surfaces it here:
 *   1. trips.created_by  = profiles.id  (host)
 *   2. trip_cohosts.user_id = profiles.id  (cohost)
 *   3. respondents.user_id = users.id  via profiles.phone → users.phone
 *      (invitee — going / maybe / cant_go / invited)
 *
 * We collect the union, dedupe by trip_id, attach the visitor's
 * RSVP (if any), and pass the whole pile to the client component
 * which owns the pill-filter state.
 *
 * Empty state: if the visitor has zero trips in any bucket, the
 * client component renders a one-button "Start a trip" prompt.
 */

import { redirect } from "next/navigation";
import { requireAuthUid } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import AppHeader from "@/lib/brand/app-header";
import TripsDashboard, { type DashboardTrip } from "./dashboard";
import type { Trip, Respondent } from "@shared/types";

export const dynamic = "force-dynamic";

export default async function TripsIndexPage() {
  const r = await requireAuthUid();
  if (!r.ok) redirect("/login?next=/trips");

  // 1. Resolve profile (for greeting + phone-keyed invitee lookup).
  const { data: profile } = await r.supabase
    .from("profiles")
    .select("id, name, last_name, phone, avatar_url")
    .eq("id", r.authUid)
    .maybeSingle();

  const greetingName = profile?.name?.trim() || "there";
  const phone = profile?.phone ?? null;

  // Service-role for the cross-table union — anon SELECT policies
  // on respondents block reading another person's row, and we need
  // to enumerate by user_id + phone in one shot.
  const svc = createServiceClient();

  // 2. Resolve the visitor's users.id so we can match respondents
  //    they've been linked to. The users row may not exist yet for
  //    a brand-new profile; that's fine (no invitee hits).
  let usersId: string | null = null;
  if (phone) {
    const { data: u } = await svc
      .from("users")
      .select("id")
      .eq("phone", phone)
      .maybeSingle();
    usersId = u?.id ?? null;
  }

  // 3. Three parallel queries, then union by trip_id.
  const [hostedRes, cohostedRes, invitedRes] = await Promise.all([
    // Hosted by me.
    svc
      .from("trips")
      .select("*")
      .eq("created_by", r.authUid)
      .order("start_date", { ascending: true, nullsFirst: false }),
    // Cohosted by me (join via trip_cohosts).
    svc
      .from("trip_cohosts")
      .select("trip_id, trips:trips!inner(*)")
      .eq("user_id", r.authUid),
    // Invited / RSVP'd as a respondent. Match by users.id first
    // (precise), and also by phone as a fallback for older rows
    // where the FK was never backfilled.
    (async () => {
      // OR via two queries — Postgres `.or()` on a related table is
      // awkward; two reads then merge in JS is simpler.
      const [byUserId, byPhone] = await Promise.all([
        usersId
          ? svc
              .from("respondents")
              .select("trip_id, rsvp_status, trips:trips!inner(*)")
              .eq("user_id", usersId)
          : Promise.resolve({ data: [] as unknown[] }),
        phone
          ? svc
              .from("respondents")
              .select("trip_id, rsvp_status, trips:trips!inner(*)")
              .eq("phone", phone)
          : Promise.resolve({ data: [] as unknown[] }),
      ]);
      // Merge + dedupe by trip_id (keep the row with a non-null
      // rsvp_status if both surface, since user_id-matched rows are
      // the authoritative ones).
      const seen = new Set<string>();
      const merged: { trip_id: string; rsvp_status: string | null; trips: Trip }[] = [];
      for (const row of [...((byUserId.data ?? []) as unknown[]), ...((byPhone.data ?? []) as unknown[])]) {
        const r = row as { trip_id: string; rsvp_status: string | null; trips: Trip };
        if (seen.has(r.trip_id)) continue;
        seen.add(r.trip_id);
        merged.push(r);
      }
      return { data: merged };
    })(),
  ]);

  // 4. Combine into a single map keyed by trip_id. Track each trip's
  //    relationship flags so the client can apply pill filters.
  const tripMap = new Map<string, DashboardTrip>();

  function upsert(trip: Trip, patch: Partial<DashboardTrip>) {
    const existing = tripMap.get(trip.id);
    if (existing) {
      tripMap.set(trip.id, { ...existing, ...patch });
    } else {
      tripMap.set(trip.id, {
        trip,
        isHost:   false,
        isCohost: false,
        isInvitee: false,
        myStatus: null,
        ...patch,
      });
    }
  }

  for (const t of (hostedRes.data ?? []) as Trip[]) {
    upsert(t, { isHost: true });
  }
  for (const row of (cohostedRes.data ?? []) as unknown as { trips: Trip | Trip[] | null }[]) {
    const trip = Array.isArray(row.trips) ? row.trips[0] : row.trips;
    if (trip) upsert(trip, { isCohost: true });
  }
  for (const row of invitedRes.data as unknown as { trips: Trip | Trip[] | null; rsvp_status: Respondent["rsvp_status"] }[]) {
    const trip = Array.isArray(row.trips) ? row.trips[0] : row.trips;
    if (trip) upsert(trip, { isInvitee: true, myStatus: row.rsvp_status ?? null });
  }

  const trips = Array.from(tripMap.values());

  return (
    <main className="min-h-dvh">
      <div className="max-w-6xl mx-auto px-5 sm:px-8 py-6">
        <AppHeader />
        <TripsDashboard
          greetingName={greetingName}
          avatarUrl={profile?.avatar_url ?? null}
          trips={trips}
        />
      </div>
    </main>
  );
}
