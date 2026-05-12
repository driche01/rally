/**
 * Shared TypeScript types — single source of truth used by /web (and
 * eventually by /supabase/functions for type-safe RPC bodies).
 *
 * Mirrors the post-Phase-A live database state. Update this file as
 * the schema evolves (additive only — never remove fields, only
 * mark old ones deprecated).
 *
 * Identity model (see SCHEMA_REPORT.md §2):
 *   - profiles.id    = auth.uid()    — authed-side mirror
 *   - users.id       = Rally id      — phone-keyed, may lack auth
 *   - users.auth_user_id → auth.uid() when the user has signed up
 *
 * As a rule: planner-side FKs target profiles.id; invitee/SMS-side
 * FKs target users.id.
 */

// ─── Trips ────────────────────────────────────────────────────────

export type TripTheme =
  | "classic"
  | "eclectic"
  | "fancy"
  | "literary"
  | "digital"
  | "elegant";

export type TripStatus = "active" | "draft"; // 'closed' is dead but the CHECK still permits it

export interface Trip {
  id: string;
  created_by: string | null;        // profiles.id
  name: string;
  destination: string | null;
  start_date: string | null;        // ISO date
  end_date: string | null;          // ISO date
  budget_min: number | null;
  budget_max: number | null;
  budget_per_person: string | null; // legacy bucket from Expo path
  theme: TripTheme | null;
  cover_image_url: string | null;
  description: string | null;
  is_public: boolean;
  status: TripStatus;
  share_token: string;
  created_at: string;
  updated_at: string;
}

// ─── Travel profile ───────────────────────────────────────────────

export type VibeBeachOrMountain   = "beach" | "mountain" | "both";
export type VibeSpaOrHike         = "spa" | "hike" | "both";
export type VibeFoodieOrCasual    = "foodie" | "casual" | "both";
export type VibeSocialOrChill     = "social" | "chill" | "both";
export type VibeCultureOrRelax    = "culture" | "relaxation" | "both";
export type BudgetComfort         = "budget" | "mid" | "premium" | "luxury";

export interface TravelerProfile {
  phone: string;                    // PK
  user_id: string | null;           // users.id
  home_airport: string | null;
  vibe_beach_or_mountain: VibeBeachOrMountain | null;
  vibe_spa_or_hike: VibeSpaOrHike | null;
  vibe_foodie_or_casual: VibeFoodieOrCasual | null;
  vibe_social_or_chill: VibeSocialOrChill | null;
  vibe_culture_or_relaxation: VibeCultureOrRelax | null;
  budget_comfort: BudgetComfort | null;
  dietary_restrictions: string[];
  vibe_captured_at: string | null;
  created_at: string;
  updated_at: string;
  // Legacy Expo-path fields (not edited by Phase A):
  travel_pref: string | null;
  sleep_pref: string | null;
  lodging_pref: string | null;
  meal_pref: string | null;
  drinking_pref: string | null;
  trip_pace: number | null;
  budget_posture: string | null;
}

export type ProfileCaptureInput = Pick<
  TravelerProfile,
  | "vibe_beach_or_mountain"
  | "vibe_spa_or_hike"
  | "vibe_foodie_or_casual"
  | "vibe_social_or_chill"
  | "vibe_culture_or_relaxation"
  | "budget_comfort"
  | "home_airport"
  | "dietary_restrictions"
>;

// ─── Respondents (invitees + RSVP) ────────────────────────────────

export type RsvpStatus = "invited" | "going" | "maybe" | "cant_go";

export interface Respondent {
  id: string;
  trip_id: string;
  user_id: string | null;           // users.id
  name: string;
  phone: string | null;
  email: string | null;
  is_planner: boolean;
  session_token: string;
  rsvp_status: RsvpStatus | null;
  rsvp_status_updated_at: string | null;
  invited_by: string | null;        // users.id
  invited_at: string | null;
  note: string | null;
  created_at: string;
  // Legacy Expo poll path:
  rsvp: "in" | "out" | null;
  preferences: unknown | null;
}

// ─── Trip cohosts ─────────────────────────────────────────────────

export interface TripCohost {
  trip_id: string;
  user_id: string;                  // profiles.id
  invited_by: string | null;        // profiles.id
  created_at: string;
}

// ─── Activity feed ────────────────────────────────────────────────

export type ActivityEntryType =
  | "rsvp_update"
  | "comment"
  | "gif"
  | "photo"
  | "system"
  | "planner_post";

export interface ActivityFeedEntry {
  id: string;
  trip_id: string;
  user_id: string | null;           // users.id
  entry_type: ActivityEntryType;
  content: Record<string, unknown>;
  created_at: string;
}

// ─── Mutuals ──────────────────────────────────────────────────────

export interface Mutual {
  user_id: string;                  // users.id
  mutual_user_id: string;           // users.id
  shared_trip_count: number;
  last_traveled_together_at: string | null;
  created_at: string;
  updated_at: string;
}

// ─── SMS log (reusing thread_messages — see Q5) ───────────────────

export type SmsMessageType =
  | "rsvp_nudge"
  | "profile_completion"
  | "booking_nudge"
  | "pre_trip_summary"
  | "planner_blast";

export interface ThreadMessage {
  id: string;
  trip_id: string | null;
  trip_session_id: string | null;   // legacy
  direction: "outbound" | "inbound";
  sender_phone: string | null;
  sender_role: string | null;
  body: string | null;
  message_sid: string | null;
  message_type: SmsMessageType | null;
  delivery_status: string | null;
  error_code: string | null;
  created_at: string;
}

// ─── Phase B: profile aggregation ─────────────────────────────────

/**
 * Per-vibe distribution. `counts` maps each value (including 'both')
 * to how many going members chose it. `total_answered` is the number
 * of profiles that supplied a non-null answer for this vibe. `skewed`
 * is the majority value, 'split' if tied, 'unknown' if no answers.
 */
export interface VibeDistribution<T extends string = string> {
  counts: Record<T, number>;
  total_answered: number;
  skewed: T | "split" | "unknown";
}

export interface TripProfileAggregate {
  trip_id: string;
  going_count: number;
  profile_complete_count: number;
  profile_incomplete_count: number;
  vibes: {
    beach_vs_mountain:     VibeDistribution<VibeBeachOrMountain>;
    spa_vs_hike:           VibeDistribution<VibeSpaOrHike>;
    foodie_vs_casual:      VibeDistribution<VibeFoodieOrCasual>;
    social_vs_chill:       VibeDistribution<VibeSocialOrChill>;
    culture_vs_relaxation: VibeDistribution<VibeCultureOrRelax>;
  };
  budget_comfort: VibeDistribution<BudgetComfort>;
  dietary_restrictions: { value: string; count: number }[];
  home_airports: { value: string; count: number }[];
  alignment_summary: string;
  computed_at: string;
}
