/**
 * Shared option lists for the traveler profile.
 *
 * Source-of-truth for both the RSVP-flow capture (<ProfileCapture>)
 * and the standalone editor on /user/[id]. Keeping them here lets us
 * tweak the copy ("salt, sun, slow start") once and have it match
 * everywhere.
 *
 * The icon names are kept on a separate ICONS map so this file stays
 * importable from anywhere (the RSVP icon sprite isn't loaded
 * elsewhere on /user/[id], so the editor doesn't pull it in).
 */

import type {
  VibeBeachOrMountain, VibeSpaOrHike, VibeFoodieOrCasual,
  VibeSocialOrChill, VibeCultureOrRelax, BudgetComfort,
} from "@shared/types";

export interface VibeOption<T extends string> {
  value: T;
  label: string;
  cap: string;
}

export const VIBE_BM: VibeOption<VibeBeachOrMountain>[] = [
  { value: "beach",    label: "Beach",    cap: "salt, sun, slow start" },
  { value: "mountain", label: "Mountain", cap: "cold air, hot coffee" },
  { value: "both",     label: "Either",   cap: "surprise me" },
];
export const VIBE_SH: VibeOption<VibeSpaOrHike>[] = [
  { value: "spa",  label: "Spa",  cap: "slow it down" },
  { value: "hike", label: "Hike", cap: "earn the view" },
  { value: "both", label: "Both", cap: "read the room" },
];
export const VIBE_FC: VibeOption<VibeFoodieOrCasual>[] = [
  { value: "foodie", label: "Foodie",  cap: "tasting menus, reservations" },
  { value: "casual", label: "Casual",  cap: "tacos, dive bars, vibes" },
  { value: "both",   label: "Mix",     cap: "one of each" },
];
export const VIBE_SC: VibeOption<VibeSocialOrChill>[] = [
  { value: "social", label: "Out",   cap: "bars, dancing, late" },
  { value: "chill",  label: "In",    cap: "cards, couch, conversation" },
  { value: "both",   label: "Depends", cap: "read the night" },
];
export const VIBE_CR: VibeOption<VibeCultureOrRelax>[] = [
  { value: "culture",    label: "See it all", cap: "museums, walks, history" },
  { value: "relaxation", label: "Do nothing", cap: "book, beach, repeat" },
  { value: "both",       label: "Bit of both", cap: "half on, half off" },
];

export const DIETARY_OPTIONS = [
  "vegetarian", "vegan", "pescatarian", "gluten_free", "dairy_free",
  "nut_allergy", "shellfish_allergy", "halal", "kosher", "no_pork",
  "no_alcohol",
] as const;

export const DIETARY_LABELS: Record<string, string> = {
  vegetarian:        "Vegetarian",
  vegan:             "Vegan",
  pescatarian:       "Pescatarian",
  gluten_free:       "Gluten-free",
  dairy_free:        "Dairy-free",
  nut_allergy:       "Nut allergy",
  shellfish_allergy: "Shellfish allergy",
  halal:             "Halal",
  kosher:            "Kosher",
  no_pork:           "No pork",
  no_alcohol:        "No alcohol",
};

export interface BudgetTier {
  value: BudgetComfort;
  mark:  string;
  label: string;
  range: string;
}
export const BUDGET_TIERS: BudgetTier[] = [
  { value: "budget",  mark: "$",    label: "Budget",     range: "Under $500" },
  { value: "mid",     mark: "$$",   label: "Mid",        range: "$500–$1.5k" },
  { value: "premium", mark: "$$$",  label: "Premium",    range: "$1.5k–$3k" },
  { value: "luxury",  mark: "$$$$", label: "No ceiling", range: "$3k+" },
];
