// Database types matching the Supabase schema

export type GroupSizeBucket = '0-4' | '5-8' | '9-12' | '13-20' | '20+';
export type TripStatus = 'active' | 'closed';
export type PollType = 'destination' | 'dates' | 'budget' | 'custom';
export type PollStatus = 'draft' | 'live' | 'closed' | 'decided';

// ─── Phase 2 enums ───────────────────────────────────────────────────────────

export type Phase2UnlockMethod = 'iap' | 'code' | 'free';
export type BlockType = 'activity' | 'meal' | 'travel' | 'accommodation' | 'free_time';
export type LodgingPlatform = 'airbnb' | 'vrbo' | 'booking' | 'manual';
export type LodgingStatus = 'option' | 'voted' | 'booked';
export type DayRsvpStatus = 'going' | 'not_sure' | 'cant_make_it';
export type ExpenseCategory = 'accommodation' | 'food' | 'transport' | 'activities' | 'gear' | 'other';
export type DiscountType = 'percentage' | 'flat' | 'full';
export type PushPlatform = 'ios' | 'android';
export type ReactorType = 'planner' | 'respondent';

export interface Profile {
  id: string;
  name: string;
  last_name: string | null;
  email: string;
  phone: string | null;
  avatar_url: string | null;
  created_at: string;
}

export interface Trip {
  id: string;
  created_by: string;
  name: string;
  group_size_bucket: GroupSizeBucket;
  /** Exact head-count entered by the planner; supersedes group_size_bucket when set. */
  group_size_precise: number | null;
  travel_window: string | null;
  share_token: string;
  status: TripStatus;
  // Phase 2 fields
  start_date: string | null;        // ISO date 'YYYY-MM-DD'
  end_date: string | null;          // ISO date 'YYYY-MM-DD'
  phase2_unlocked: boolean;
  phase2_unlocked_at: string | null;
  phase2_unlock_method: Phase2UnlockMethod | null;
  // Phase 3 fields
  trip_type: string | null;         // comma-separated trip type labels
  budget_per_person: string | null; // human-readable label e.g. "$500–$1k"
  destination: string | null;         // display name, e.g. "Dawn Ranch"
  destination_address: string | null; // full address for map links, e.g. "Dawn Ranch, CA 116, Guerneville, CA, USA"
  trip_duration: string | null;       // planner's target length, e.g. "3 days"
  // 1:1 SMS pivot fields (migration 044)
  book_by_date: string | null;        // ISO date 'YYYY-MM-DD' — external deadline (book by)
  responses_due_date: string | null;  // ISO date 'YYYY-MM-DD' — internal deadline (book_by - 3 by default)
  custom_intro_sms: string | null;    // planner override for the initial outreach SMS body
  created_at: string;
  updated_at: string;
}

export interface Poll {
  id: string;
  trip_id: string;
  type: PollType;
  title: string;
  allow_multi_select: boolean;
  /** When true, respondents can add new poll_options via the
   *  submit_poll_write_in RPC. Used today by destination polls created
   *  with 0 chips (group fills it in) and by duration polls (group can
   *  add custom night-counts on top of the planner's chips). */
  allow_write_ins: boolean;
  status: PollStatus;
  decided_option_id: string | null;
  position: number;
  created_at: string;
}

export interface PollOption {
  id: string;
  poll_id: string;
  label: string;
  position: number;
  created_at: string;
}

export interface RespondentPreferences {
  needs: string[];
  vibes: string[];
  pace: string | null;
  /** Phase 4.2 — relaxing vs adventurous energy preference */
  energy: 'relaxing' | 'adventurous' | null;
}

export interface Respondent {
  id: string;
  trip_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  session_token: string;
  is_planner: boolean;
  rsvp: 'in' | 'out' | null;
  preferences: RespondentPreferences | null;
  created_at: string;
}

export type TripMemberRole = 'planner' | 'member';

export interface TripMember {
  id: string;
  trip_id: string;
  user_id: string;
  role: TripMemberRole;
  joined_at: string;
}

export interface TripMemberWithProfile extends TripMember {
  profiles: Pick<Profile, 'name' | 'email'>;
}

export interface PollResponse {
  id: string;
  poll_id: string;
  respondent_id: string;
  /** Set for option-based responses; null when numeric_value is used. */
  option_id: string | null;
  /** Set for free-form numeric responses (e.g. duration polls with no
   *  preset options); null when option_id is used. Exactly one of
   *  option_id / numeric_value is non-null. */
  numeric_value: number | null;
  created_at: string;
}

// ─── Travel Legs ─────────────────────────────────────────────────────────────

export type TransportMode = 'flight' | 'train' | 'car' | 'ferry' | 'bus' | 'other';

export interface TravelLeg {
  id: string;
  trip_id: string;
  respondent_id: string | null;
  mode: TransportMode;
  label: string;
  departure_date: string | null;
  departure_time: string | null;
  arrival_date: string | null;
  arrival_time: string | null;
  booking_ref: string | null;
  notes: string | null;
  shared_with_group: boolean;
  created_at: string;
}

export interface TravelLegWithRespondent extends TravelLeg {
  respondent_name: string;
}

// ─── Phase 2 interfaces ──────────────────────────────────────────────────────

export interface PushToken {
  id: string;
  user_id: string;
  token: string;
  platform: PushPlatform;
  created_at: string;
  updated_at: string;
}

export interface ItineraryBlock {
  id: string;
  trip_id: string;
  day_date: string;         // 'YYYY-MM-DD'
  type: BlockType;
  title: string;
  start_time: string | null; // 'HH:MM'
  end_time: string | null;
  location: string | null;
  notes: string | null;
  position: number;
  attendee_ids: string[] | null; // null = all group members
  lodging_option_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface DayRsvp {
  id: string;
  trip_id: string;
  respondent_id: string;
  day_date: string;  // 'YYYY-MM-DD'
  status: DayRsvpStatus;
  created_at: string;
  updated_at: string;
}

export interface LodgingOption {
  id: string;
  trip_id: string;
  platform: LodgingPlatform;
  title: string;
  url: string | null;
  notes: string | null;
  check_in_date: string | null;
  check_out_date: string | null;
  check_in_time: string | null;
  check_out_time: string | null;
  total_cost_cents: number | null;
  nightly_rate_cents: number | null;
  status: LodgingStatus;
  booking_confirmation: string | null;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface LodgingVote {
  id: string;
  lodging_option_id: string;
  trip_id: string;
  respondent_id: string;
  created_at: string;
}

export interface TripMessage {
  id: string;
  trip_id: string;
  sender_id: string;
  content: string;
  itinerary_block_id: string | null;
  is_pinned: boolean;
  read_count: number;
  created_at: string;
  updated_at: string;
}

export interface MessageReaction {
  id: string;
  message_id: string;
  reactor_type: ReactorType;
  reactor_id: string;
  emoji: string;
  created_at: string;
}

export interface DiscountCode {
  id: string;
  code: string;
  discount_type: DiscountType;
  discount_value: number;
  max_uses: number;
  use_count: number;
  expires_at: string | null;
  is_active: boolean;
  created_at: string;
}

export interface DiscountCodeRedemption {
  id: string;
  code_id: string;
  planner_id: string;
  trip_id: string;
  discount_applied_cents: number;
  created_at: string;
}

export interface Expense {
  id: string;
  trip_id: string;
  description: string;
  category: ExpenseCategory;
  amount_cents: number;
  paid_by_planner_id: string | null;
  paid_by_respondent_id: string | null;
  itinerary_block_id: string | null;
  lodging_option_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExpenseSplit {
  id: string;
  expense_id: string;
  amount_cents: number;
  split_planner_id: string | null;
  split_respondent_id: string | null;
  is_settled: boolean;
  settled_at: string | null;
  created_at: string;
}

// ─── Phase 2 rich / joined types ─────────────────────────────────────────────

export interface ItineraryDay {
  date: string;           // 'YYYY-MM-DD'
  blocks: ItineraryBlock[];
  rsvpCounts: { going: number; not_sure: number; cant_make_it: number };
}

export interface LodgingOptionWithVotes extends LodgingOption {
  votes: LodgingVote[];
  voteCount: number;
}

export interface TripMessageWithReactions extends TripMessage {
  reactions: MessageReaction[];
  senderProfile?: Pick<Profile, 'id' | 'name'>;
}

export interface ExpenseWithSplits extends Expense {
  splits: ExpenseSplit[];
}

// Balance for a single participant (respondent or planner)
export interface ParticipantBalance {
  id: string;          // respondent_id or planner_id
  name: string;
  type: 'planner' | 'respondent';
  owes: number;        // cents — what this person owes others
  owed: number;        // cents — what others owe this person
  net: number;         // cents — positive = net owed to them, negative = net they owe
}

// ─── Rich / joined types ─────────────────────────────────────────────────────

export interface PollWithOptions extends Poll {
  poll_options: PollOption[];
}

export interface PollWithResults extends PollWithOptions {
  poll_responses: (PollResponse & { respondents: Pick<Respondent, 'name'> })[];
}

export interface TripWithPolls extends Trip {
  polls: PollWithOptions[];
}

// ─── Direct messaging (Phase 3) ───────────────────────────────────────────────

export type ConversationType = 'dm' | 'group';

export interface Conversation {
  id: string;
  type: ConversationType;
  name: string | null;      // group display name; null for DMs
  avatar_url: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;       // bumped on each new message — use for sort order
}

export interface ConversationMember {
  conversation_id: string;
  profile_id: string;
  joined_at: string;
  last_read_at: string;
}

export interface ConversationMessage {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  reply_to_id: string | null;
  thread_parent_id: string | null;
  thread_reply_count: number;
  created_at: string;
  edited_at: string | null;
}

export interface ConversationReaction {
  id: string;
  message_id: string;
  profile_id: string;
  emoji: string;
  created_at: string;
}

// Rich joined types
export interface ConversationWithPreview extends Conversation {
  members: (ConversationMember & { profile: Pick<Profile, 'id' | 'name'> })[];
  lastMessage: ConversationMessage | null;
  unreadCount: number;
}

export interface ConversationMessageWithMeta extends ConversationMessage {
  senderProfile: Pick<Profile, 'id' | 'name'>;
  reactions: (ConversationReaction & { senderName: string })[];
  replyTo: Pick<ConversationMessage, 'id' | 'content' | 'sender_id'> | null;
}

// ─── Participation helpers ────────────────────────────────────────────────────

export const GROUP_SIZE_MIDPOINTS: Record<GroupSizeBucket, number> = {
  '0-4': 4,
  '5-8': 8,
  '9-12': 12,
  '13-20': 20,
  '20+': 20,
};

export function getParticipationRate(
  respondentCount: number,
  bucket: GroupSizeBucket,
  /** Exact count from `group_size_precise`; used in place of the bucket upper bound when provided. */
  precise?: number | null
): { count: number; total: number; percent: number } {
  const total = precise ?? GROUP_SIZE_MIDPOINTS[bucket];
  const percent = Math.min(100, Math.round((respondentCount / total) * 100));
  return { count: respondentCount, total, percent };
}

// ─── Phase 4.2 — AI itinerary types ──────────────────────────────────────────

export interface AiItineraryBlock {
  type: BlockType;
  title: string;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  notes: string | null;
}

export interface AiItineraryDay {
  date: string; // 'YYYY-MM-DD'
  blocks: AiItineraryBlock[];
}

export interface AiItineraryOption {
  index: number;
  label: 'Packed' | 'Balanced' | 'Relaxed';
  theme: string;   // one-sentence tone/style description
  summary: string; // 2-3 sentence overview of the option
  days: AiItineraryDay[];
}

export type AiItineraryStatus = 'generating' | 'ready' | 'error';

export interface AiItineraryDraft {
  id: string;
  trip_id: string;
  status: AiItineraryStatus;
  options: AiItineraryOption[];
  planner_override: string | null;
  selected_index: number | null;
  applied_at: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Phase 4.3 — AI block alternatives ────────────────────────────────────────

export interface AiBlockAlternative {
  title: string;
  type: BlockType;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  notes: string | null;
  reason: string; // one-sentence explanation of why this suits the group
}

// ─── Trip sessions (1:1 SMS pivot — Phase 4 dashboard reads) ────────────────

export type SmsTripSessionStatus =
  | 'ACTIVE'
  | 'PAUSED'
  | 'SPLIT'
  | 'CANCELLED'
  | 'ABANDONED'
  | 'FIRST_BOOKING_REACHED'
  | 'RE_ENGAGEMENT_PENDING';

export type SmsPhase =
  | 'INTRO'
  | 'COLLECTING_DESTINATIONS'
  | 'DECIDING_DATES'
  | 'BUDGET_POLL'
  | 'BUDGET_DISCUSSION'
  | 'DECIDING_DESTINATION'
  | 'COLLECTING_ORIGINS'
  | 'ESTIMATING_COSTS'
  | 'COMMIT_POLL'
  | 'CREATING_COMMITTED_THREAD'
  | 'AWAITING_PLANNER_DECISION'
  | 'AWAITING_FLIGHTS'
  | 'DECIDING_LODGING_TYPE'
  | 'AWAITING_GROUP_BOOKING'
  | 'AWAITING_INDIVIDUAL_LODGING'
  | 'AWAITING_INDIVIDUAL_FLIGHTS'
  | 'FIRST_BOOKING_REACHED'
  | 'RECOMMENDING'
  | 'COMPLETE';

export interface TripSession {
  id: string;
  trip_id: string | null;
  thread_id: string | null;
  planner_user_id: string | null;
  phase: SmsPhase;
  status: SmsTripSessionStatus;
  destination: string | null;
  dates: { start: string; end: string; nights?: number; flexible?: boolean } | null;
  budget_median: number | null;
  budget_status: string;
  thread_name: string | null;
  trip_model: string;
  last_message_at: string | null;
  paused: boolean;
  created_at: string;
  updated_at: string;
}

export type TripSessionParticipantStatus =
  | 'active'
  | 'opted_out'
  | 'removed_by_planner'
  | 'inactive';

export interface TripSessionParticipant {
  id: string;
  trip_session_id: string;
  user_id: string | null;
  phone: string;
  display_name: string | null;
  status: TripSessionParticipantStatus;
  is_planner: boolean;
  is_attending: boolean;
  committed: boolean;
  flight_status: string | null;
  origin_city: string | null;
  origin_airport: string | null;
  joined_at: string;
  created_at: string;
  updated_at: string;
  /** Most-recent inbound SMS or survey activity. Null until first touch. */
  last_activity_at: string | null;
}

// ─── Budget tier constants ─────────────────────────────────────────────────────

export const BUDGET_TIERS = [
  { id: 'under_500', label: 'Under $500' },
  { id: '500_1000', label: '$500–$1,000' },
  { id: '1000_2000', label: '$1,000–$2,000' },
  { id: '2000_plus', label: '$2,000+' },
] as const;

export type BudgetTierId = (typeof BUDGET_TIERS)[number]['id'];
