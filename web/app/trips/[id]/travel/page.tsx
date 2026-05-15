/**
 * /trips/[id]/travel — Travel tab.
 *
 * Server: fetches going respondents + their arrangements (if any)
 * + their home_airports (for the flight-suggest CTA) + car
 * groupings + grouping members. Renders TravelTab.
 *
 * Phase B Step 6. v0 ships: per-member arrangement edit, planner
 * "Suggest flights" per member, car groupings with assignment.
 * Defer: arrival/departure timeline view (Phase B follow-up).
 */

import { notFound, redirect } from "next/navigation";
import { requireAuthUid } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import type { Trip } from "@shared/types";
import TravelTab, { type TravelMember, type GroupingView } from "./travel-tab";

export default async function TravelPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const r = await requireAuthUid();
  if (!r.ok) redirect(`/login?next=/trips/${id}/travel`);

  const { data: tripRow } = await r.supabase
    .from("trips")
    .select("id, name, destination, start_date, end_date, theme, created_by")
    .eq("id", id)
    .maybeSingle();
  if (!tripRow) notFound();
  const trip = tripRow as Pick<Trip, "id" | "name" | "destination" | "start_date" | "end_date" | "theme" | "created_by">;

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
  const [respondentsRes, arrangementsRes, profilesRes, groupingsRes, groupingMembersRes, callerUserRes] = await Promise.all([
    svc.from("respondents")
       .select("id, name, phone, rsvp_status, is_planner, user_id")
       .eq("trip_id", id),
    svc.from("travel_arrangements")
       .select("id, respondent_id, arrival_mode, arrival_datetime, departure_datetime, flight_number, flight_origin_airport, flight_destination_airport, vehicle_capacity, gear_notes")
       .eq("trip_id", id),
    svc.from("traveler_profiles").select("phone, home_airport"),
    svc.from("travel_groupings")
       .select("id, direction, departure_datetime, driver_respondent_id, notes, seats_total, space_comfort, ride_notes, created_at")
       .eq("trip_id", id)
       .order("departure_datetime", { ascending: true }),
    svc.from("travel_grouping_members")
       .select("grouping_id, respondent_id, pre_assigned, added_by_respondent_id"),
    svc.from("users").select("id").eq("auth_user_id", r.authUid).maybeSingle(),
  ]);

  const respondents = (respondentsRes.data ?? []) as { id: string; name: string; phone: string | null; rsvp_status: string | null; is_planner: boolean; user_id: string | null }[];
  const arrangements = (arrangementsRes.data ?? []) as Record<string, unknown>[];
  const profiles = (profilesRes.data ?? []) as { phone: string; home_airport: string | null }[];
  const groupings = (groupingsRes.data ?? []) as { id: string; direction: string; departure_datetime: string; driver_respondent_id: string | null; notes: string | null; seats_total: number | null; space_comfort: string | null; ride_notes: string | null; created_at: string }[];
  const groupingMembers = (groupingMembersRes.data ?? []) as { grouping_id: string; respondent_id: string; pre_assigned: boolean; added_by_respondent_id: string | null }[];

  // Resolve the caller's respondent_id on this trip so the UI knows
  // who "self" is — for "Join this ride" + "leave" affordances.
  let callerRespondentId: string | null = null;
  const callerUserId = callerUserRes.data?.id as string | undefined;
  if (callerUserId) {
    const caller = respondents.find((r) => r.user_id === callerUserId);
    callerRespondentId = caller?.id ?? null;
  }

  // Build a name + airport lookup keyed on phone.
  const airportByPhone = new Map<string, string>();
  for (const p of profiles) {
    if (p.phone && p.home_airport) airportByPhone.set(p.phone, p.home_airport);
  }

  // Only members who said yes/maybe show up on this tab.
  const goingMembers: TravelMember[] = respondents
    .filter((m) => m.rsvp_status === "going" || m.rsvp_status === "maybe")
    .map((m) => {
      const arr = arrangements.find((a) => a.respondent_id === m.id);
      return {
        respondent_id: m.id,
        name: m.name,
        is_planner: m.is_planner,
        home_airport: m.phone ? airportByPhone.get(m.phone) ?? null : null,
        arrangement: arr
          ? {
              arrival_mode:               (arr.arrival_mode as string | null) ?? null,
              arrival_datetime:           (arr.arrival_datetime as string | null) ?? null,
              departure_datetime:         (arr.departure_datetime as string | null) ?? null,
              flight_number:              (arr.flight_number as string | null) ?? null,
              flight_origin_airport:      (arr.flight_origin_airport as string | null) ?? null,
              flight_destination_airport: (arr.flight_destination_airport as string | null) ?? null,
              vehicle_capacity:           (arr.vehicle_capacity as number | null) ?? null,
              gear_notes:                 (arr.gear_notes as string | null) ?? null,
            }
          : null,
      };
    })
    .sort((a, b) => Number(b.is_planner) - Number(a.is_planner) || a.name.localeCompare(b.name));

  const groupingViews: GroupingView[] = groupings.map((g) => ({
    id: g.id,
    direction: g.direction as "outbound" | "return",
    departure_datetime: g.departure_datetime,
    driver_respondent_id: g.driver_respondent_id,
    notes: g.notes,
    seats_total: g.seats_total,
    space_comfort: g.space_comfort as ("tight" | "comfortable" | "spacious") | null,
    ride_notes: g.ride_notes,
    members: groupingMembers
      .filter((gm) => gm.grouping_id === g.id)
      .map((gm) => ({
        respondent_id: gm.respondent_id,
        pre_assigned: gm.pre_assigned,
      })),
  }));

  return (
    <TravelTab
      tripId={trip.id}
      tripTheme={trip.theme}
      destination={trip.destination}
      startDate={trip.start_date}
      endDate={trip.end_date}
      canManage={canManage}
      callerRespondentId={callerRespondentId}
      members={goingMembers}
      groupings={groupingViews}
    />
  );
}
