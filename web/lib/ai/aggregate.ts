/**
 * Profile aggregation engine — Phase B prerequisite (build guide §4).
 *
 * Takes the travel profiles of all `going` members of a trip and produces
 * structured aggregate data that AI prompts can use. Every downstream
 * Phase B feature (itinerary, lodging, travel, meals) consumes this.
 *
 * Pure compute: no DB calls, no caching, no side effects. The caller
 * supplies the rows; this returns the aggregate. Easy to unit-test.
 *
 * Empty-profile handling baked in: every vibe / budget distribution
 * reports counts plus `skewed` (majority value, or 'split' on tie /
 * 'unknown' when nobody answered).
 */

import type {
  Respondent,
  TravelerProfile,
  VibeBeachOrMountain,
  VibeSpaOrHike,
  VibeFoodieOrCasual,
  VibeSocialOrChill,
  VibeCultureOrRelax,
  BudgetComfort,
} from "@shared/types";
import type { TripProfileAggregate, VibeDistribution } from "@shared/types";

interface AggregateInput {
  tripId: string;
  /** Respondents on the trip with rsvp_status='going'. */
  goingRespondents: Pick<Respondent, "id" | "phone" | "name">[];
  /** All traveler_profiles rows keyed by phone (one per phone). Phones
      not in this map are treated as "no profile captured". */
  profilesByPhone: Map<string, Pick<
    TravelerProfile,
    | "vibe_beach_or_mountain"
    | "vibe_spa_or_hike"
    | "vibe_foodie_or_casual"
    | "vibe_social_or_chill"
    | "vibe_culture_or_relaxation"
    | "budget_comfort"
    | "home_airport"
    | "dietary_restrictions"
    | "vibe_captured_at"
  >>;
}

export function aggregateTripProfiles(
  input: AggregateInput,
): TripProfileAggregate {
  const { tripId, goingRespondents, profilesByPhone } = input;

  let profileCompleteCount = 0;
  const beachOrMountain   = newDist<VibeBeachOrMountain>();
  const spaOrHike         = newDist<VibeSpaOrHike>();
  const foodieOrCasual    = newDist<VibeFoodieOrCasual>();
  const socialOrChill     = newDist<VibeSocialOrChill>();
  const cultureOrRelax    = newDist<VibeCultureOrRelax>();
  const budget            = newDist<BudgetComfort>();
  const dietary           = new Map<string, number>();
  const airports          = new Map<string, number>();

  for (const r of goingRespondents) {
    if (!r.phone) continue;
    const p = profilesByPhone.get(r.phone);
    if (!p) continue;
    if (p.vibe_captured_at) profileCompleteCount++;

    bump(beachOrMountain,   p.vibe_beach_or_mountain);
    bump(spaOrHike,         p.vibe_spa_or_hike);
    bump(foodieOrCasual,    p.vibe_foodie_or_casual);
    bump(socialOrChill,     p.vibe_social_or_chill);
    bump(cultureOrRelax,    p.vibe_culture_or_relaxation);
    bump(budget,            p.budget_comfort);

    for (const d of p.dietary_restrictions ?? []) {
      dietary.set(d, (dietary.get(d) ?? 0) + 1);
    }
    if (p.home_airport) {
      airports.set(p.home_airport, (airports.get(p.home_airport) ?? 0) + 1);
    }
  }

  const goingCount = goingRespondents.length;
  const profileIncompleteCount = Math.max(0, goingCount - profileCompleteCount);

  const vibes = {
    beach_vs_mountain:    finalizeDist(beachOrMountain),
    spa_vs_hike:          finalizeDist(spaOrHike),
    foodie_vs_casual:     finalizeDist(foodieOrCasual),
    social_vs_chill:      finalizeDist(socialOrChill),
    culture_vs_relaxation:finalizeDist(cultureOrRelax),
  };

  const budgetFinal = finalizeDist(budget);

  return {
    trip_id: tripId,
    going_count: goingCount,
    profile_complete_count: profileCompleteCount,
    profile_incomplete_count: profileIncompleteCount,
    vibes,
    budget_comfort: budgetFinal,
    dietary_restrictions: sortedTopValues(dietary),
    home_airports: sortedTopValues(airports),
    alignment_summary: buildAlignmentSummary({
      profileCompleteCount,
      goingCount,
      vibes,
      budget: budgetFinal,
    }),
    computed_at: new Date().toISOString(),
  };
}

// ─── Helpers ────────────────────────────────────────────────────────

function newDist<T extends string>(): Map<T | "_total_answered", number> {
  return new Map();
}

function bump<T extends string>(
  m: Map<T | "_total_answered", number>,
  v: T | null | undefined,
) {
  if (!v) return;
  m.set(v, ((m.get(v) ?? 0) as number) + 1);
  m.set("_total_answered", ((m.get("_total_answered") ?? 0) as number) + 1);
}

function finalizeDist<T extends string>(
  m: Map<T | "_total_answered", number>,
): VibeDistribution<T> {
  // Pull out the synthetic _total_answered and keep just the value-keys.
  const counts: Record<string, number> = {};
  let max = 0;
  let topKey: string | null = null;
  let isTie = false;
  for (const [k, n] of m.entries()) {
    if (k === "_total_answered") continue;
    counts[k] = n;
    if (n > max) {
      max = n;
      topKey = k;
      isTie = false;
    } else if (n === max && n > 0 && topKey !== null && k !== topKey) {
      isTie = true;
    }
  }
  const totalAnswered = (m.get("_total_answered") ?? 0) as number;
  const skewed: VibeDistribution<T>["skewed"] =
    totalAnswered === 0 ? "unknown" : isTie ? "split" : (topKey as T) ?? "unknown";
  return { counts: counts as Record<T, number>, total_answered: totalAnswered, skewed };
}

function sortedTopValues(m: Map<string, number>): { value: string; count: number }[] {
  return Array.from(m.entries())
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

function buildAlignmentSummary({
  profileCompleteCount,
  goingCount,
  vibes,
  budget,
}: {
  profileCompleteCount: number;
  goingCount: number;
  vibes: TripProfileAggregate["vibes"];
  budget: VibeDistribution<BudgetComfort>;
}): string {
  if (profileCompleteCount === 0) {
    return goingCount === 0
      ? "No one's confirmed yet — invite people to start planning."
      : "Profiles still coming in — generated suggestions will refine as more friends complete theirs.";
  }

  const PRETTY_BUDGET: Record<BudgetComfort | "split" | "unknown", string> = {
    budget: "budget",
    mid: "mid-budget",
    premium: "premium",
    luxury: "no-ceiling",
    split: "mixed budgets",
    unknown: "budget unknown",
  };

  const aligned: string[] = [];
  const split: string[] = [];

  push(vibes.beach_vs_mountain,     "beach", "mountain",     aligned, split, "beach", "mountain");
  push(vibes.spa_vs_hike,           "spa",   "hike",         aligned, split, "spa",   "hike");
  push(vibes.foodie_vs_casual,      "foodie","casual",       aligned, split, "foodie","casual");
  push(vibes.social_vs_chill,       "social","chill",        aligned, split, "social","chill");
  push(vibes.culture_vs_relaxation, "culture","relaxation",  aligned, split, "culture","relaxation");

  if (budget.skewed && budget.skewed !== "unknown" && budget.skewed !== "split") {
    aligned.push(PRETTY_BUDGET[budget.skewed]);
  } else if (budget.skewed === "split") {
    split.push("budget");
  }

  const ratioNote = profileCompleteCount < goingCount * 0.5
    ? ` (only ${profileCompleteCount} of ${goingCount} profiles in yet)`
    : "";

  const alignedPart = aligned.length ? `Strong alignment: ${aligned.join(", ")}.` : "";
  const splitPart   = split.length   ? ` Split: ${split.join(", ")}.` : "";
  return `${alignedPart}${splitPart}${ratioNote}`.trim() || "No clear pattern yet.";
}

function push<A extends string, B extends string>(
  d: VibeDistribution<A | B | "both">,
  aLabel: string,
  bLabel: string,
  aligned: string[],
  split: string[],
  aValue: A,
  bValue: B,
) {
  if (d.skewed === "split") {
    split.push(`${aLabel} vs ${bLabel}`);
  } else if (d.skewed === aValue) {
    aligned.push(aLabel);
  } else if (d.skewed === bValue) {
    aligned.push(bLabel);
  }
  // "both" or "unknown" → no entry
}
