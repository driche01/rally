/**
 * /invite/[token]/travel — respondent-facing Travel tab.
 *
 * Mirrors the planner's /trips/[id]/travel page but anon-readable via
 * the share token. Reuses the same TravelTab component, just passes
 * `canManage={false}` so planner-only affordances (create groupings,
 * suggest flights for others, etc.) are suppressed.
 *
 * Self-edit / join-a-ride affordances key on the respondent's
 * rally_session_token cookie — same identity model as the Overview
 * page. The cookie maps to a respondent row on this trip; that row's
 * id becomes `callerRespondentId` so TravelTab can show "Add my
 * arrangement" / "Join this ride" on the caller's own data.
 *
 * Token validation: any unknown token → 404. The token itself is the
 * gate (matches /invite/[token] behavior).
 */

import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { themeClass } from "@/lib/themes";
import AppHeader from "@/lib/brand/app-header";
import RsvpButtons from "../rsvp-buttons";
import RespondentTabNav from "../tabs";
import TravelTab, {
  type TravelMember,
  type GroupingView,
} from "@/app/trips/[id]/travel/travel-tab";
import type { Trip, Respondent } from "@shared/types";

interface PageProps {
  params: Promise<{ token: string }>;
}

export default async function InviteTravelPage({ params }: PageProps) {
  const { token } = await params;

  const anon = await createClient();

  // 1. Trip by share token (anon-allowed per RLS).
  const { data: tripRow } = await anon
    .from("trips")
    .select("*")
    .eq("share_token", token)
    .maybeSingle();
  if (!tripRow) notFound();
  const trip = tripRow as Trip;
  const t = themeClass(trip.theme);

  const svc = createServiceClient();

  // 2. Pull every data source TravelTab needs. Same shape as the
  //    planner page so the component can render identically.
  const [respondentsRes, arrangementsRes, profilesRes, groupingsRes, groupingMembersRes] = await Promise.all([
    anon.from("respondents")
      .select("id, name, first_name, phone, rsvp_status, is_planner, user_id, session_token")
      .eq("trip_id", trip.id),
    svc.from("travel_arrangements")
      .select("id, respondent_id, arrival_mode, arrival_datetime, departure_datetime, flight_number, flight_origin_airport, flight_destination_airport, vehicle_capacity, gear_notes")
      .eq("trip_id", trip.id),
    svc.from("traveler_profiles").select("phone, home_airport"),
    svc.from("travel_groupings")
      .select("id, direction, departure_datetime, driver_respondent_id, notes, seats_total, space_comfort, ride_notes, created_at")
      .eq("trip_id", trip.id)
      .order("departure_datetime", { ascending: true }),
    svc.from("travel_grouping_members")
      .select("grouping_id, respondent_id, pre_assigned, added_by_respondent_id"),
  ]);

  const respondents     = (respondentsRes.data     ?? []) as (Respondent & { session_token: string | null })[];
  const arrangements    = (arrangementsRes.data    ?? []) as Record<string, unknown>[];
  const profiles        = (profilesRes.data        ?? []) as { phone: string; home_airport: string | null }[];
  const groupings       = (groupingsRes.data       ?? []) as { id: string; direction: string; departure_datetime: string; driver_respondent_id: string | null; notes: string | null; seats_total: number | null; space_comfort: string | null; ride_notes: string | null; created_at: string }[];
  const groupingMembers = (groupingMembersRes.data ?? []) as { grouping_id: string; respondent_id: string; pre_assigned: boolean; added_by_respondent_id: string | null }[];

  // 3. Identify the caller respondent via the cookie set on RSVP.
  //    This is what lets "Join this ride" / "leave" work without auth.
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get("rally_session_token")?.value ?? null;
  const me = sessionToken
    ? respondents.find((r) => r.session_token === sessionToken) ?? null
    : null;
  const callerRespondentId = me?.id ?? null;

  // 4. Build the shape TravelTab expects.
  const airportByPhone = new Map<string, string>();
  for (const p of profiles) {
    if (p.phone && p.home_airport) airportByPhone.set(p.phone, p.home_airport);
  }

  const members: TravelMember[] = respondents
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
    <main className={`min-h-dvh ${t.root}`}>
      <div className="max-w-6xl mx-auto px-5 sm:px-8 py-6">
        <AppHeader />

        <div className="lg:grid lg:grid-cols-[5fr_7fr] lg:gap-10">

          {/* ── Left column: cover + RSVP / cancellation slot ── */}
          <div className="space-y-4 lg:space-y-0 lg:sticky lg:top-0 lg:h-[100dvh] lg:flex lg:flex-col lg:justify-center lg:gap-4 mb-6 lg:mb-0">
            {trip.cover_image_url ? (
              <div
                className={`block aspect-square w-full rounded-[28px] bg-cover bg-center ${t.cover}`}
                style={{ backgroundImage: `url(${escapeCss(trip.cover_image_url)})` }}
                aria-hidden="true"
              />
            ) : (
              <div className={`block aspect-square w-full rounded-[28px] ${t.cover}`}>
                <div className="h-full flex items-center justify-center px-6">
                  <span className={`text-3xl sm:text-4xl text-center ${t.coverInk}`}>
                    {trip.name}
                  </span>
                </div>
              </div>
            )}

            {trip.cancelled_at ? (
              <div className="bg-orange/10 border border-orange/40 rounded-2xl p-4">
                <p className="text-xs font-bold tracking-widest uppercase text-orange mb-1">
                  Cancelled
                </p>
                <p className={`text-sm ${t.body}`}>
                  This trip was cancelled by the host. The feed is still live, but RSVPs and new comments are closed.
                </p>
              </div>
            ) : (
              <RsvpButtons
                tripId={trip.id}
                shareToken={trip.share_token}
                myStatus={me?.rsvp_status ?? null}
                myFirstName={me?.first_name ?? (me?.name ? me.name.split(" ")[0] : null)}
              />
            )}
          </div>

          {/* ── Right column: tab nav + TravelTab content ── */}
          <div>
            <RespondentTabNav token={token} />
            <TravelTab
              tripId={trip.id}
              tripTheme={trip.theme}
              destination={trip.destination}
              startDate={trip.start_date}
              endDate={trip.end_date}
              // Alpha policy (2026-05-19): respondents have planner-
              // equivalent edit abilities on tab content. The underlying
              // travel endpoints all gate on resolveTripParticipant
              // which treats respondents as managers. canManage=true
              // turns on every TravelTab affordance for the respondent.
              canManage={true}
              callerRespondentId={callerRespondentId}
              members={members}
              groupings={groupingViews}
            />
          </div>
        </div>
      </div>
    </main>
  );
}

function escapeCss(url: string): string {
  return url.replace(/[()'"\\]/g, "\\$&");
}
