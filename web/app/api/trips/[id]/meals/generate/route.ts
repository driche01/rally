/**
 * POST /api/trips/[id]/meals/generate
 *
 * Authed planner/cohost generates a meal plan covering each day of
 * the trip (breakfast / lunch / dinner) via Claude. Per Q17,
 * ingredients are normalized at generation time so the shopping
 * list aggregation downstream is a simple sum-by-name-and-unit.
 *
 * Body: { regenerate?: boolean }
 */

import { requireAuthUid } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { aggregateTripProfiles } from "@/lib/ai/aggregate";
import { callClaudeJson } from "@/lib/ai/anthropic";
import { jsonErr, jsonOk } from "@/lib/http";
import type { Respondent, TravelerProfile, TripProfileAggregate } from "@shared/types";

interface ClaudeIngredient {
  name: string;        // canonical lowercase, e.g. "garlic clove"
  quantity: number;
  unit: string;        // canonical unit, e.g. "clove" / "lb" / "head" / "can"
  category: "produce" | "meat_fish" | "dairy_fridge" | "pantry" | "other";
}

interface ClaudeMeal {
  day_date: string;
  meal_type: "breakfast" | "lunch" | "dinner" | "snack";
  mode: "cook_in" | "restaurant" | "tbd";
  recipe_name?: string;       // cook_in
  restaurant_name?: string;   // restaurant
  restaurant_url?: string;
  notes?: string;
  ingredients?: ClaudeIngredient[]; // cook_in only; omitted for restaurant
}

interface ClaudeMealResponse {
  meals: ClaudeMeal[];
  note?: string;
}

const MEAL_TYPES = new Set(["breakfast", "lunch", "dinner", "snack"]);
const MODES = new Set(["cook_in", "restaurant", "tbd"]);
const CATEGORIES = new Set(["produce", "meat_fish", "dairy_fridge", "pantry", "other"]);

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const r = await requireAuthUid();
  if (!r.ok) return jsonErr(r.status, "unauthenticated");
  const { id: trip_id } = await ctx.params;

  const body = (await req.json().catch(() => ({}))) as { regenerate?: boolean };

  const { data: trip, error: tripErr } = await r.supabase
    .from("trips")
    .select("id, name, destination, start_date, end_date, created_by")
    .eq("id", trip_id)
    .maybeSingle();
  if (tripErr) return jsonErr(500, "trip_read_failed", tripErr.message);
  if (!trip)   return jsonErr(404, "trip_not_found");

  const isPlanner = trip.created_by === r.authUid;
  if (!isPlanner) {
    const { data: cohost } = await r.supabase
      .from("trip_cohosts").select("trip_id")
      .eq("trip_id", trip_id).eq("user_id", r.authUid).maybeSingle();
    if (!cohost) return jsonErr(403, "forbidden");
  }

  if (!trip.start_date || !trip.end_date) return jsonErr(400, "dates_required");

  const svc = createServiceClient();
  const aggregate = await computeAggregate(svc, trip_id);

  const prompt = buildPrompt({
    name: trip.name,
    destination: trip.destination,
    start_date: trip.start_date,
    end_date: trip.end_date,
    aggregate,
  });

  const result = await callClaudeJson<ClaudeMealResponse>({
    admin: svc,
    tripId: trip_id,
    callerUserId: r.authUid,
    kind: "meal_plan_generate",
    user: prompt,
    maxTokens: 6000,
  });

  if (!result.ok) return jsonErr(502, "claude_failed", result.error);

  const claudeMeals = Array.isArray(result.data.meals) ? result.data.meals : [];
  if (claudeMeals.length === 0) return jsonErr(502, "claude_no_meals");

  // If regenerate, delete prior AI-generated meals (cascades meal_
  // ingredients + meal_votes via FK).
  if (body.regenerate) {
    await svc.from("meals").delete().eq("trip_id", trip_id).eq("ai_suggested", true);
  }

  const startTs = new Date(trip.start_date + "T00:00:00").getTime();
  const endTs   = new Date(trip.end_date   + "T23:59:59").getTime();

  // Pre-flight validation + filter.
  const valid = claudeMeals.filter((m) => {
    if (!m.day_date || !m.meal_type || !m.mode) return false;
    if (!MEAL_TYPES.has(m.meal_type)) return false;
    if (!MODES.has(m.mode)) return false;
    const ts = new Date(m.day_date + "T00:00:00").getTime();
    return ts >= startTs && ts <= endTs;
  });

  if (valid.length === 0) return jsonErr(502, "claude_meals_out_of_range");

  // Insert meals one-by-one so we can attach ingredients per meal.
  const insertedMeals: { id: string; meal: ClaudeMeal }[] = [];
  for (const m of valid) {
    const { data: inserted, error: insErr } = await svc
      .from("meals")
      .insert({
        trip_id,
        day_date: m.day_date,
        meal_type: m.meal_type,
        mode: m.mode,
        recipe_name: m.recipe_name?.trim().slice(0, 200) ?? null,
        restaurant_name: m.restaurant_name?.trim().slice(0, 200) ?? null,
        restaurant_url: m.restaurant_url?.trim() ?? null,
        notes: m.notes?.trim().slice(0, 1000) ?? null,
        ai_suggested: true,
      })
      .select("id")
      .single();
    if (insErr || !inserted) continue;
    insertedMeals.push({ id: inserted.id, meal: m });

    // Ingredients (cook_in only).
    if (m.mode === "cook_in" && Array.isArray(m.ingredients)) {
      const ingredientRows = m.ingredients
        .filter((ing) => ing.name && typeof ing.quantity === "number")
        .map((ing) => ({
          meal_id: inserted.id,
          name: ing.name.trim().toLowerCase().slice(0, 100),
          quantity: ing.quantity,
          unit: (ing.unit || "unit").trim().toLowerCase().slice(0, 30),
          category: CATEGORIES.has(ing.category) ? ing.category : "other",
        }));
      if (ingredientRows.length > 0) {
        await svc.from("meal_ingredients").insert(ingredientRows);
      }
    }
  }

  await svc.from("activity_feed_entries").insert({
    trip_id,
    user_id: null,
    entry_type: "system",
    content: {
      text: `AI meal plan: ${insertedMeals.length} meal${insertedMeals.length === 1 ? "" : "s"}.`,
      kind: "meal_plan_generated",
      count: insertedMeals.length,
    },
  });

  return jsonOk({
    inserted: insertedMeals.length,
    note: result.data.note ?? null,
    profile_complete_count: aggregate.profile_complete_count,
    going_count: aggregate.going_count,
  });
}

// ─── Helpers ───────────────────────────────────────────────────

async function computeAggregate(
  svc: ReturnType<typeof createServiceClient>,
  trip_id: string,
): Promise<TripProfileAggregate> {
  const { data: respondents } = await svc
    .from("respondents")
    .select("id, phone, name")
    .eq("trip_id", trip_id)
    .eq("rsvp_status", "going");
  const goingRespondents = (respondents ?? []) as Pick<Respondent, "id" | "phone" | "name">[];
  const phones = goingRespondents.map((r) => r.phone).filter((p): p is string => !!p);

  type Slice = Pick<TravelerProfile,
    | "vibe_beach_or_mountain" | "vibe_spa_or_hike" | "vibe_foodie_or_casual"
    | "vibe_social_or_chill" | "vibe_culture_or_relaxation"
    | "budget_comfort" | "home_airport" | "dietary_restrictions" | "vibe_captured_at"
  >;
  const profilesByPhone = new Map<string, Slice>();
  if (phones.length > 0) {
    const { data: profiles } = await svc
      .from("traveler_profiles")
      .select("phone, vibe_beach_or_mountain, vibe_spa_or_hike, vibe_foodie_or_casual, vibe_social_or_chill, vibe_culture_or_relaxation, budget_comfort, home_airport, dietary_restrictions, vibe_captured_at")
      .in("phone", phones);
    for (const p of (profiles ?? []) as (Slice & { phone: string })[]) {
      profilesByPhone.set(p.phone, p);
    }
  }
  return aggregateTripProfiles({ tripId: trip_id, goingRespondents, profilesByPhone });
}

function buildPrompt({
  name, destination, start_date, end_date, aggregate,
}: {
  name: string;
  destination: string | null;
  start_date: string;
  end_date: string;
  aggregate: TripProfileAggregate;
}): string {
  const days = enumerateDays(start_date, end_date);
  const diets = aggregate.dietary_restrictions.map((d) => `${d.value} (${d.count})`).join(", ") || "none";
  const vibesSummary = JSON.stringify(aggregate.vibes, null, 2);
  const budget = aggregate.budget_comfort.skewed;

  const profileHedge = aggregate.profile_complete_count === 0
    ? `\n\nIMPORTANT: zero profiles complete yet (${aggregate.going_count} going). Generate generic meal plans without dietary assumptions; include a "note" flagging the data is thin.`
    : aggregate.profile_complete_count < aggregate.going_count / 2
    ? `\n\nNOTE: only ${aggregate.profile_complete_count} of ${aggregate.going_count} profiles in. Honor the dietary signals you have; flag in "note" that the plan may need updating.`
    : "";

  return `Generate a meal plan for this group trip. Cover breakfast, lunch, and dinner for each day. Mix cook-in nights (groceries + recipe) with restaurant nights (real spots in the destination).

Trip: "${name}"${destination ? ` to ${destination}` : ""}
Dates: ${start_date} → ${end_date}
Days: ${JSON.stringify(days)}

Aggregated group preferences:
- Vibes (counts per dimension):
${vibesSummary}
- Budget skew: ${budget}
- Dietary restrictions across the group: ${diets}
- Group size: ${aggregate.going_count} going
- Alignment: ${aggregate.alignment_summary}${profileHedge}

Constraints
- For each day, output 3 meals (breakfast / lunch / dinner). Add snacks only if a "social" or party vibe is strong.
- Mode mix: cook_in for breakfasts + some lunches/dinners; restaurant for the rest. A 'social' or 'foodie' skew leans toward more restaurants; 'chill' or 'budget' skew leans toward more cook-in.
- HONOR THE DIETARY RESTRICTIONS. Every meal must be compatible with every dietary restriction listed above. Substitute proteins / cuisines as needed.
- Restaurant suggestions must be plausible for the destination — name + a short URL (search-link or restaurant page).
- For cook_in meals, include 5-15 ingredients. CRITICAL: ingredient names must be NORMALIZED so the shopping list can aggregate. Use canonical lowercase singular forms, e.g.:
    * "garlic clove" (not "2 cloves garlic" or "Garlic")
    * "olive oil" (not "Olive Oil" or "EVOO")
    * "chicken thigh" (not "Boneless Chicken Thighs")
    * "yellow onion" (not "Onion, diced")
  Use canonical units: clove, head, lb, oz, cup, tbsp, tsp, can, bunch, unit.
  Categorize each ingredient: produce | meat_fish | dairy_fridge | pantry | other.

Output strict JSON only (no prose, no fences):
{
  "meals": [
    {
      "day_date": "YYYY-MM-DD",
      "meal_type": "breakfast" | "lunch" | "dinner" | "snack",
      "mode": "cook_in" | "restaurant" | "tbd",
      "recipe_name": "string (if cook_in)",
      "restaurant_name": "string (if restaurant)",
      "restaurant_url": "string (if restaurant)",
      "notes": "string (one sentence)",
      "ingredients": [
        { "name": "garlic clove", "quantity": 6, "unit": "clove", "category": "produce" },
        ...
      ]
    }
  ],
  "note": "(optional planner-facing hedge if data is thin)"
}`;
}

function enumerateDays(start: string, end: string): string[] {
  const out: string[] = [];
  const s = new Date(start + "T00:00:00").getTime();
  const e = new Date(end   + "T00:00:00").getTime();
  for (let t = s; t <= e; t += 24 * 3600 * 1000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}
