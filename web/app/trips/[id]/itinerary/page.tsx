/**
 * /trips/[id]/itinerary — Itinerary tab.
 *
 * Server component: fetches the trip + itinerary blocks + vote tallies
 * + the planner's respondent_id (so the client can show their own
 * current vote per item). Renders the client ItineraryTab.
 *
 * Phase B Step 4. Per build guide §5: AI generation, voting, manual
 * edits, alternatives. v0 ships AI gen + voting + manual edit/delete;
 * alternatives pattern lands in a follow-up.
 */

import { notFound, redirect } from "next/navigation";
import { requireAuthUid } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import ItineraryTab from "./itinerary-tab";
import type { Trip } from "@shared/types";
import type { ItineraryItemWithVotes } from "./itinerary-tab";

export default async function ItineraryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const r = await requireAuthUid();
  if (!r.ok) redirect(`/login?next=/trips/${id}/itinerary`);

  const { data: tripRow } = await r.supabase
    .from("trips")
    .select("id, name, start_date, end_date, theme, created_by")
    .eq("id", id)
    .maybeSingle();
  if (!tripRow) notFound();
  const trip = tripRow as Pick<Trip, "id" | "name" | "start_date" | "end_date" | "theme" | "created_by">;

  // Is the caller the planner (or cohost)?
  const isPlanner = trip.created_by === r.authUid;
  let isCohost = false;
  if (!isPlanner) {
    const { data: cohost } = await r.supabase
      .from("trip_cohosts")
      .select("trip_id")
      .eq("trip_id", id)
      .eq("user_id", r.authUid)
      .maybeSingle();
    isCohost = !!cohost;
  }

  // Pull items, votes, and the planner's respondent_id (for voting
  // as themselves).
  const svc = createServiceClient();
  const [itemsRes, votesRes, plannerRespRes, userRes] = await Promise.all([
    svc.from("itinerary_blocks")
       .select("id, trip_id, day_date, type, title, start_time, end_time, location, notes, location_url, position, ai_generated, created_by, created_at, updated_at")
       .eq("trip_id", id)
       .order("day_date", { ascending: true })
       .order("start_time", { ascending: true, nullsFirst: true })
       .order("position", { ascending: true }),
    svc.from("itinerary_item_votes")
       .select("itinerary_block_id, respondent_id, vote"),
    svc.from("respondents")
       .select("id, name")
       .eq("trip_id", id),
    svc.from("users")
       .select("id, phone")
       .eq("auth_user_id", r.authUid)
       .maybeSingle(),
  ]);

  const items = itemsRes.data ?? [];
  const allVotes = votesRes.data ?? [];

  // Index votes by item, and find the caller's respondent_id on this trip.
  type ItemRow = (typeof items)[number];
  const respondentsByName = new Map<string, string>();
  const respondentsAll = (plannerRespRes.data ?? []) as { id: string; name: string }[];

  // Resolve caller's respondent_id via users.id → respondents.user_id.
  let callerRespondentId: string | null = null;
  if (userRes.data?.id) {
    const { data: callerResp } = await svc
      .from("respondents")
      .select("id")
      .eq("trip_id", id)
      .eq("user_id", userRes.data.id)
      .maybeSingle();
    callerRespondentId = callerResp?.id ?? null;
  }

  const itemsWithVotes: ItineraryItemWithVotes[] = items.map((it: ItemRow) => {
    const votes = allVotes.filter((v) => v.itinerary_block_id === it.id);
    const tallies: { yes: number; no: number; maybe: number } = { yes: 0, no: 0, maybe: 0 };
    let myVote: "yes" | "no" | "maybe" | null = null;
    for (const v of votes) {
      const vv = v.vote as "yes" | "no" | "maybe" | string;
      if (vv === "yes" || vv === "no" || vv === "maybe") {
        tallies[vv]++;
        if (callerRespondentId && v.respondent_id === callerRespondentId) {
          myVote = vv;
        }
      }
    }
    return { ...it, tallies, myVote };
  });

  return (
    <ItineraryTab
      tripId={trip.id}
      tripTheme={trip.theme}
      startDate={trip.start_date}
      endDate={trip.end_date}
      canGenerate={isPlanner || isCohost}
      items={itemsWithVotes}
      callerRespondentId={callerRespondentId}
    />
  );
}
