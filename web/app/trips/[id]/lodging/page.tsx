/**
 * /trips/[id]/lodging — Lodging tab.
 *
 * Server: fetches options + votes + room assignments + going
 * respondents (for the assignment UI) + the caller's respondent
 * (for voting). Renders the LodgingTab client.
 *
 * Phase B Step 5. v0 ships: AI suggest, vote, select, simple room
 * assignment. Drag-drop assignment + advanced cost-split UI come in
 * a follow-up.
 */

import { notFound, redirect } from "next/navigation";
import { requireAuthUid } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import type { Trip } from "@shared/types";
import LodgingTab, { type LodgingOptionView, type GoingMember } from "./lodging-tab";

export default async function LodgingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const r = await requireAuthUid();
  if (!r.ok) redirect(`/login?next=/trips/${id}/lodging`);

  const { data: tripRow } = await r.supabase
    .from("trips")
    .select("id, name, destination, start_date, end_date, theme, created_by, group_size_bucket, group_size_precise")
    .eq("id", id)
    .maybeSingle();
  if (!tripRow) notFound();
  const trip = tripRow as Pick<Trip, "id" | "name" | "destination" | "start_date" | "end_date" | "theme" | "created_by" | "group_size_bucket" | "group_size_precise">;

  const isPlanner = trip.created_by === r.authUid;
  let isCohost = false;
  if (!isPlanner) {
    const { data: cohost } = await r.supabase
      .from("trip_cohosts").select("trip_id")
      .eq("trip_id", id).eq("user_id", r.authUid).maybeSingle();
    isCohost = !!cohost;
  }
  const canManage = isPlanner || isCohost;

  const svc = createServiceClient();
  const [optsRes, votesRes, assignsRes, goingRes, userRes] = await Promise.all([
    svc.from("lodging_options")
       .select("id, trip_id, title, platform, url, notes, status, total_cost_cents, nightly_rate_cents, room_layout, ai_suggested, position, created_at")
       .eq("trip_id", id)
       .order("status", { ascending: false })   // 'selected' first
       .order("position", { ascending: true }),
    svc.from("lodging_votes")
       .select("lodging_option_id, respondent_id, vote"),
    svc.from("lodging_room_assignments")
       .select("id, lodging_option_id, respondent_id, room_label, nights, cost_owed_cents, payment_status"),
    svc.from("respondents")
       .select("id, name, phone, rsvp_status")
       .eq("trip_id", id),
    svc.from("users")
       .select("id, phone")
       .eq("auth_user_id", r.authUid)
       .maybeSingle(),
  ]);

  const options = optsRes.data ?? [];
  const allVotes = votesRes.data ?? [];
  const allAssignments = assignsRes.data ?? [];

  // Caller's respondent on this trip (for voting as themselves).
  let callerRespondentId: string | null = null;
  if (userRes.data?.id) {
    const { data: callerResp } = await svc
      .from("respondents").select("id")
      .eq("trip_id", id).eq("user_id", userRes.data.id).maybeSingle();
    callerRespondentId = callerResp?.id ?? null;
  }

  const goingMembers: GoingMember[] = ((goingRes.data ?? []) as { id: string; name: string; rsvp_status: string | null }[])
    .filter((m) => m.rsvp_status === "going" || m.rsvp_status === "maybe" || m.rsvp_status === null)
    .map((m) => ({ id: m.id, name: m.name }));

  const optionViews: LodgingOptionView[] = options.map((o) => {
    const votes = allVotes.filter((v) => v.lodging_option_id === o.id);
    const tallies = { yes: 0, no: 0, maybe: 0 };
    let myVote: "yes" | "no" | "maybe" | null = null;
    for (const v of votes) {
      const vv = v.vote as string;
      if (vv === "yes" || vv === "no" || vv === "maybe") {
        tallies[vv]++;
        if (callerRespondentId && v.respondent_id === callerRespondentId) myVote = vv;
      }
    }
    const assignments = allAssignments
      .filter((a) => a.lodging_option_id === o.id)
      .map((a) => ({
        id: a.id as string,
        respondent_id: a.respondent_id as string,
        room_label: a.room_label as string,
        nights: a.nights as number,
        cost_owed_cents: a.cost_owed_cents as number,
        payment_status: a.payment_status as "unpaid" | "pending" | "paid",
      }));
    return {
      id: o.id as string,
      title: o.title as string,
      platform: (o.platform as string) ?? "other",
      url: (o.url as string | null) ?? null,
      notes: (o.notes as string | null) ?? null,
      status: (o.status as string) ?? "option",
      total_cost_cents: (o.total_cost_cents as number | null) ?? null,
      nightly_rate_cents: (o.nightly_rate_cents as number | null) ?? null,
      room_layout: (o.room_layout as { room: string; beds: string }[] | null) ?? null,
      ai_suggested: !!o.ai_suggested,
      tallies,
      myVote,
      assignments,
    };
  });

  return (
    <LodgingTab
      tripId={trip.id}
      tripName={trip.name}
      tripTheme={trip.theme}
      destination={trip.destination}
      startDate={trip.start_date}
      endDate={trip.end_date}
      groupSizePrecise={trip.group_size_precise}
      groupSizeBucket={trip.group_size_bucket}
      canManage={canManage}
      callerRespondentId={callerRespondentId}
      goingMembers={goingMembers}
      options={optionViews}
    />
  );
}
