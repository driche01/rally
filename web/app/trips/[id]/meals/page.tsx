/**
 * /trips/[id]/meals — Meals tab.
 *
 * Server: fetches meals + meal_ingredients + meal_votes + going
 * members. Renders MealsTab.
 *
 * Phase B Step 7. v0 ships: AI generate via Claude (with normalized
 * ingredients per Q17), vote, cook assignment per meal. Manual
 * meal create/edit/delete deferred to a follow-up.
 */

import { notFound, redirect } from "next/navigation";
import { requireAuthUid } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import type { Trip } from "@shared/types";
import MealsTab, { type MealView, type GoingMember } from "./meals-tab";

export default async function MealsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const r = await requireAuthUid();
  if (!r.ok) redirect(`/login?next=/trips/${id}/meals`);

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
  const [mealsRes, ingRes, votesRes, respondentsRes, userRes] = await Promise.all([
    svc.from("meals")
       .select("id, trip_id, day_date, meal_type, mode, recipe_name, restaurant_name, restaurant_url, notes, assigned_cook_respondent_ids, ai_suggested")
       .eq("trip_id", id)
       .order("day_date", { ascending: true }),
    svc.from("meal_ingredients")
       .select("meal_id, name, quantity, unit, category"),
    svc.from("meal_votes").select("meal_id, respondent_id, vote"),
    svc.from("respondents")
       .select("id, name, phone, rsvp_status")
       .eq("trip_id", id),
    svc.from("users")
       .select("id, phone")
       .eq("auth_user_id", r.authUid)
       .maybeSingle(),
  ]);

  const meals = mealsRes.data ?? [];
  const ingredients = ingRes.data ?? [];
  const votes = votesRes.data ?? [];
  const respondents = (respondentsRes.data ?? []) as { id: string; name: string; phone: string | null; rsvp_status: string | null }[];

  // Caller's respondent.
  let callerRespondentId: string | null = null;
  if (userRes.data?.id) {
    const { data: callerResp } = await svc
      .from("respondents").select("id")
      .eq("trip_id", id).eq("user_id", userRes.data.id).maybeSingle();
    callerRespondentId = callerResp?.id ?? null;
  }

  const going: GoingMember[] = respondents
    .filter((m) => m.rsvp_status === "going" || m.rsvp_status === "maybe")
    .map((m) => ({ id: m.id, name: m.name }));

  const mealViews: MealView[] = meals.map((m) => {
    const myVotes = votes.filter((v) => v.meal_id === m.id);
    const tallies = { yes: 0, no: 0, maybe: 0 };
    let myVote: "yes" | "no" | "maybe" | null = null;
    for (const v of myVotes) {
      const vv = v.vote as string;
      if (vv === "yes" || vv === "no" || vv === "maybe") {
        tallies[vv]++;
        if (callerRespondentId && v.respondent_id === callerRespondentId) myVote = vv;
      }
    }
    const ings = ingredients.filter((i) => i.meal_id === m.id) as {
      name: string; quantity: number; unit: string; category: string;
    }[];
    return {
      id: m.id as string,
      day_date: m.day_date as string,
      meal_type: m.meal_type as "breakfast" | "lunch" | "dinner" | "snack",
      mode: m.mode as "cook_in" | "restaurant" | "tbd",
      recipe_name: (m.recipe_name as string | null) ?? null,
      restaurant_name: (m.restaurant_name as string | null) ?? null,
      restaurant_url: (m.restaurant_url as string | null) ?? null,
      notes: (m.notes as string | null) ?? null,
      assigned_cook_respondent_ids: (m.assigned_cook_respondent_ids as string[] | null) ?? [],
      ai_suggested: !!m.ai_suggested,
      ingredients: ings,
      tallies,
      myVote,
    };
  });

  return (
    <MealsTab
      tripId={trip.id}
      tripTheme={trip.theme}
      startDate={trip.start_date}
      endDate={trip.end_date}
      canManage={canManage}
      callerRespondentId={callerRespondentId}
      goingMembers={going}
      meals={mealViews}
    />
  );
}
