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
  email: string;
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
  created_at: string;
  updated_at: string;
}

export interface Poll {
  id: string;
  trip_id: string;
  type: PollType;
  title: string;
  allow_multi_select: boolean;
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

export interface Respondent {
  id: string;
  trip_id: string;
  name: string;
  session_token: string;
  created_at: string;
}

export interface PollResponse {
  id: string;
  poll_id: string;
  respondent_id: string;
  option_id: string;
  created_at: string;
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

// ─── Budget tier constants ─────────────────────────────────────────────────────

export const BUDGET_TIERS = [
  { id: 'under_500', label: 'Under $500' },
  { id: '500_1000', label: '$500–$1,000' },
  { id: '1000_2000', label: '$1,000–$2,000' },
  { id: '2000_plus', label: '$2,000+' },
] as const;

export type BudgetTierId = (typeof BUDGET_TIERS)[number]['id'];
