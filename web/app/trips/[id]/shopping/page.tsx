/**
 * /trips/[id]/shopping — Shopping list tab.
 *
 * The wow feature. Aggregates meal_ingredients across all cook_in
 * meals into shopping_list_items, categorized + assignable +
 * acquirable.
 *
 * Phase B Step 8.
 */

import { notFound, redirect } from "next/navigation";
import { requireAuthUid } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import type { Trip } from "@shared/types";
import ShoppingTab, { type ShoppingItemView, type GoingMember } from "./shopping-tab";

export default async function ShoppingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const r = await requireAuthUid();
  if (!r.ok) redirect(`/login?next=/trips/${id}/shopping`);

  const { data: tripRow } = await r.supabase
    .from("trips")
    .select("id, name, theme, created_by")
    .eq("id", id)
    .maybeSingle();
  if (!tripRow) notFound();
  const trip = tripRow as Pick<Trip, "id" | "name" | "theme" | "created_by">;

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
  const [itemsRes, mealsRes, respRes] = await Promise.all([
    svc.from("shopping_list_items")
       .select("id, trip_id, name, total_quantity, unit, category, assigned_respondent_id, is_acquired, source_meal_ids, created_at")
       .eq("trip_id", id)
       .order("category", { ascending: true })
       .order("name", { ascending: true }),
    svc.from("meals")
       .select("id, mode")
       .eq("trip_id", id)
       .eq("mode", "cook_in"),
    svc.from("respondents")
       .select("id, name, rsvp_status")
       .eq("trip_id", id),
  ]);

  const items = (itemsRes.data ?? []) as Record<string, unknown>[];
  const cookInMealCount = (mealsRes.data ?? []).length;
  const respondents = (respRes.data ?? []) as { id: string; name: string; rsvp_status: string | null }[];

  const goingMembers: GoingMember[] = respondents
    .filter((m) => m.rsvp_status === "going" || m.rsvp_status === "maybe")
    .map((m) => ({ id: m.id, name: m.name }));

  const itemViews: ShoppingItemView[] = items.map((i) => ({
    id: i.id as string,
    name: i.name as string,
    total_quantity: i.total_quantity as number,
    unit: i.unit as string,
    category: i.category as string,
    assigned_respondent_id: (i.assigned_respondent_id as string | null) ?? null,
    is_acquired: !!i.is_acquired,
    source_meal_count: Array.isArray(i.source_meal_ids) ? (i.source_meal_ids as string[]).length : 0,
  }));

  return (
    <ShoppingTab
      tripId={trip.id}
      tripTheme={trip.theme}
      canManage={canManage}
      cookInMealCount={cookInMealCount}
      goingMembers={goingMembers}
      items={itemViews}
    />
  );
}
