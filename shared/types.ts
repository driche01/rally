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
  // ─── Vibes (the original six) ───────────────────────────────────
  | "classic"
  | "eclectic"
  | "fancy"
  | "literary"
  | "digital"
  | "elegant"
  // ─── Light ──────────────────────────────────────────────────────
  | "mist"
  | "blossom"
  | "sage"
  // ─── Dark ───────────────────────────────────────────────────────
  | "midnight"
  | "forest"
  | "noir"
  // ─── Vibes (new) ────────────────────────────────────────────────
  | "sunset"
  | "neon"
  // ─── Seasonal ───────────────────────────────────────────────────
  | "spring"
  | "summer"
  | "autumn"
  | "winter";

/** Category bucket for the theme picker filters. */
export type ThemeCategory = "vibes" | "light" | "dark" | "seasonal";

/** Visual effect rendered as an animated overlay on the trip page. */
export type TripEffect =
  | "sparkles"
  | "confetti"
  | "hearts"
  | "snowflakes"
  | "bubbles"
  | "petals"
  | "embers"
  | "stars";

/** Category bucket for the effect picker. */
export type EffectCategory = "fun" | "classic" | "seasonal";

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
  group_size_bucket: string;        // '0-4'|'5-8'|'9-12'|'13-20'|'20+' (CHECK)
  group_size_precise: number | null;
  theme: TripTheme | null;
  cover_image_url: string | null;
  description: string | null;
  is_public: boolean;
  status: TripStatus;
  share_token: string;
  created_at: string;
  updated_at: string;
  // Phase C — cancellation (migration 135)
  cancelled_at: string | null;
  cancelled_by: string | null;      // profiles.id
  // Alpha+ — booking deadline (Q35). DB nullable for legacy rows;
  // app-layer requires it at trip creation.
  book_by_date: string | null;      // ISO date 'YYYY-MM-DD'
  // Alpha+ — animated overlay rendered on the trip page (Partiful-
  // inspired). NULL = no effect.
  effect: TripEffect | null;
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
  first_name: string | null;
  last_name: string | null;
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
  name: string;                     // legacy full-name field; kept in sync with first_name + last_name
  first_name: string | null;
  last_name: string | null;
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
  /** Parent entry for threaded replies. Null = top-level post. */
  parent_id: string | null;
}

export interface ActivityReaction {
  id: string;
  entry_id: string;
  user_id: string;                  // users.id
  emoji: string;
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

/**
 * App-layer enum for `thread_messages.message_type`. The column itself
 * is `text NULL` with no CHECK (per Q5); this union is the single
 * source of truth for valid values. Keep in sync with
 * `scheduled_reminders.message_type` CHECK (a strict subset — only
 * the auto-reminder types).
 */
export type SmsMessageType =
  | "rsvp_nudge"
  | "profile_completion_nudge"
  | "booking_nudge"
  | "pre_trip_summary"
  | "re_engagement"
  | "final_rsvp_reminder"
  | "cancellation_notice"
  | "planner_blast";

/** Strict subset of `SmsMessageType` valid in `scheduled_reminders`. */
export type ReminderMessageType =
  | "rsvp_nudge"
  | "profile_completion_nudge"
  | "booking_nudge"
  | "pre_trip_summary"
  | "re_engagement"
  | "final_rsvp_reminder";

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

// ─── Phase C: reminders + blasts ──────────────────────────────────

export type ReminderStatus = "pending" | "sent" | "cancelled" | "skipped";

export interface ScheduledReminder {
  id: string;
  trip_id: string;
  recipient_respondent_id: string;  // respondents.id (Q18)
  message_type: ReminderMessageType;
  scheduled_for: string;
  status: ReminderStatus;
  sent_thread_message_id: string | null;
  attempted_at: string | null;
  skip_reason: string | null;
  created_at: string;
  updated_at: string;
}

export type RecipientSegment = "going" | "maybe" | "invited" | "all" | "unresponded";

export interface PlannerBlast {
  id: string;
  trip_id: string;
  composed_by: string;              // profiles.id (Q20)
  recipient_segment: RecipientSegment;
  message_body: string;
  include_planner: boolean;
  recipient_count: number;
  sent_count: number;
  failed_count: number;
  suppressed_opted_out: number;
  scheduled_for: string | null;
  sent_at: string | null;
  auto_posted_to_feed: boolean;
  activity_feed_entry_id: string | null;
  created_at: string;
}

export interface PlannerBlastSend {
  id: string;
  blast_id: string;
  recipient_respondent_id: string;  // respondents.id (Q18)
  thread_message_id: string | null;
  delivery_status: string | null;
  error_code: string | null;
  sent_at: string | null;
  created_at: string;
}

export interface TripReminderSettings {
  trip_id: string;
  rsvp_nudge_enabled: boolean;
  profile_completion_enabled: boolean;
  booking_nudge_enabled: boolean;
  pre_trip_summary_enabled: boolean;
  re_engagement_enabled: boolean;
  final_rsvp_reminder_enabled: boolean;
  created_at: string;
  updated_at: string;
}

