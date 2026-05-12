/**
 * /trips/[id] — Overview tab.
 *
 * The hero + tab nav live in /trips/[id]/layout.tsx. This page is
 * just the Overview tab's content (stats, actions, roster, activity
 * preview).
 */

import { notFound, redirect } from "next/navigation";
import { requireAuthUid } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { getSiteUrl } from "@/lib/site-url";
import type { Trip, Respondent, ActivityFeedEntry } from "@shared/types";
import TripDashboard from "./trip-dashboard";

export default async function TripOverviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const r = await requireAuthUid();
  if (!r.ok) redirect(`/login?next=/trips/${id}`);

  // Trip is already fetched in the layout; we need it here too for
  // the description + share-link + invite modal props. Cheap
  // double-fetch; trade-off is the layout doesn't have a clean way
  // to pass server-fetched data to children without prop-drilling
  // through the page-segment boundary.
  const { data: tripRow } = await r.supabase
    .from("trips")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!tripRow) notFound();
  const trip = tripRow as Trip;

  const svc = createServiceClient();
  const [respondentsRes, activityRes] = await Promise.all([
    svc.from("respondents")
       .select("*")
       .eq("trip_id", id)
       .order("created_at", { ascending: true }),
    svc.from("activity_feed_entries")
       .select("*")
       .eq("trip_id", id)
       .order("created_at", { ascending: false })
       .limit(15),
  ]);
  const respondents = (respondentsRes.data ?? []) as Respondent[];
  const activity = (activityRes.data ?? []) as ActivityFeedEntry[];

  const baseUrl = await getSiteUrl();
  const inviteUrl = `${baseUrl}/invite/${trip.share_token}`;

  return (
    <TripDashboard
      trip={trip}
      respondents={respondents}
      activity={activity}
      inviteUrl={inviteUrl}
    />
  );
}
