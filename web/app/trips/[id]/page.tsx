/**
 * /trips/[id] — planner trip dashboard.
 *
 * Phase A scope (build guide §6 Step 7): trip header + roster + share
 * link + invite trigger. Steps 8-10 layer SMS nudges, activity feed
 * real-time, and mutuals population on top.
 */

import { notFound, redirect } from "next/navigation";
import { requireAuthUid } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import type { Trip, Respondent, ActivityFeedEntry } from "@shared/types";
import TripDashboard from "./trip-dashboard";

export default async function TripPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const r = await requireAuthUid();
  if (!r.ok) redirect(`/login?next=/trips/${id}`);

  const { data: tripRow, error } = await r.supabase
    .from("trips")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    return (
      <main className="min-h-dvh flex items-center justify-center p-6">
        <p className="text-orange">Couldn&apos;t load trip: {error.message}</p>
      </main>
    );
  }
  if (!tripRow) notFound();
  const trip = tripRow as Trip;

  // Roster + activity feed in parallel. Use service-role to bypass
  // the respondents RLS noise — RLS already allowed it, but we want
  // the freshest read with a single round-trip.
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

  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
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
