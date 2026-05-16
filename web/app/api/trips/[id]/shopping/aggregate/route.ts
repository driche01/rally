/**
 * POST /api/trips/[id]/shopping/aggregate
 *
 * Authed planner/cohost (re)builds the shopping_list_items for
 * this trip by aggregating meal_ingredients across all cook_in
 * meals.
 *
 * Per Q17, ingredients are normalized at meal-plan generation, so
 * the aggregation here is a straight sum-by-(name, unit). If the
 * same logical ingredient appears with different units (e.g.,
 * "garlic" in "clove" vs "head"), they stay as separate rows
 * (Phase B v0 — "surface unit conflicts" is human-resolved by
 * seeing them in the list).
 *
 * Preserves: assigned_respondent_id, is_acquired on rows where
 * the (name, unit) pair is unchanged. Items that no longer have a
 * source meal get removed.
 */

import { requireAuthUid } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { jsonErr, jsonOk } from "@/lib/http";

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const r = await requireAuthUid();
  if (!r.ok) return jsonErr(r.status, "unauthenticated");
  const { id: trip_id } = await ctx.params;

  const { data: trip } = await r.supabase
    .from("trips").select("id, created_by").eq("id", trip_id).maybeSingle();
  if (!trip) return jsonErr(404, "trip_not_found");
  if (trip.created_by !== r.authUid) {
    const { data: cohost } = await r.supabase
      .from("trip_cohosts").select("trip_id")
      .eq("trip_id", trip_id).eq("user_id", r.authUid).maybeSingle();
    if (!cohost) return jsonErr(403, "forbidden");
  }

  const svc = createServiceClient();

  // 1. Pull all cook_in meals on this trip + their ingredients.
  const { data: meals } = await svc
    .from("meals")
    .select("id")
    .eq("trip_id", trip_id)
    .eq("mode", "cook_in");
  const mealIds = (meals ?? []).map((m) => m.id as string);

  let ingredients: { meal_id: string; name: string; quantity: number; unit: string; category: string }[] = [];
  if (mealIds.length > 0) {
    const { data, error } = await svc
      .from("meal_ingredients")
      .select("meal_id, name, quantity, unit, category")
      .in("meal_id", mealIds);
    if (error) return jsonErr(500, "ingredient_read_failed", error.message);
    ingredients = (data ?? []) as typeof ingredients;
  }

  // 2. Preserve existing assignment + acquired state.
  const { data: existingItems } = await svc
    .from("shopping_list_items")
    .select("id, name, unit, assigned_respondent_id, is_acquired")
    .eq("trip_id", trip_id);
  const existingByKey = new Map<string, { id: string; assigned_respondent_id: string | null; is_acquired: boolean }>();
  for (const e of (existingItems ?? []) as { id: string; name: string; unit: string; assigned_respondent_id: string | null; is_acquired: boolean }[]) {
    existingByKey.set(key(e.name, e.unit), {
      id: e.id,
      assigned_respondent_id: e.assigned_respondent_id,
      is_acquired: e.is_acquired,
    });
  }

  // 3. Aggregate.
  type Agg = {
    name: string; unit: string;
    total_quantity: number;
    category: string;                       // pick most-common
    category_counts: Map<string, number>;
    source_meal_ids: Set<string>;
  };
  const aggMap = new Map<string, Agg>();

  for (const ing of ingredients) {
    const k = key(ing.name, ing.unit);
    const cur = aggMap.get(k);
    if (cur) {
      cur.total_quantity += ing.quantity;
      cur.source_meal_ids.add(ing.meal_id);
      cur.category_counts.set(ing.category, (cur.category_counts.get(ing.category) ?? 0) + 1);
    } else {
      aggMap.set(k, {
        name: ing.name,
        unit: ing.unit,
        total_quantity: ing.quantity,
        category: ing.category,
        category_counts: new Map([[ing.category, 1]]),
        source_meal_ids: new Set([ing.meal_id]),
      });
    }
  }

  // Resolve category by majority vote.
  for (const a of aggMap.values()) {
    let topCat = a.category;
    let topCount = 0;
    for (const [cat, count] of a.category_counts.entries()) {
      if (count > topCount) { topCount = count; topCat = cat; }
    }
    a.category = topCat;
  }

  // 4. Wipe + insert. Simpler than partial diff; meal_ingredients is
  //    the source of truth so a fresh aggregate is always safe.
  //    Preserving assigned + is_acquired re-applies them by key.
  await svc.from("shopping_list_items").delete().eq("trip_id", trip_id);

  const rows = Array.from(aggMap.values()).map((a) => {
    const preserved = existingByKey.get(key(a.name, a.unit));
    return {
      trip_id,
      name: a.name,
      unit: a.unit,
      total_quantity: a.total_quantity,
      category: a.category,
      source_meal_ids: Array.from(a.source_meal_ids),
      assigned_respondent_id: preserved?.assigned_respondent_id ?? null,
      is_acquired: preserved?.is_acquired ?? false,
    };
  });

  if (rows.length === 0) {
    return jsonOk({ count: 0, items: [] });
  }

  const { data: inserted, error: insErr } = await svc
    .from("shopping_list_items")
    .insert(rows)
    .select("*");
  if (insErr) return jsonErr(500, "shopping_insert_failed", insErr.message);

  return jsonOk({ count: rows.length, items: inserted ?? [] });
}

function key(name: string, unit: string): string {
  return `${name.toLowerCase()}|${unit.toLowerCase()}`;
}
