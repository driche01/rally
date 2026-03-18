// Database types matching the Supabase schema

export type GroupSizeBucket = '0-4' | '5-8' | '9-12' | '13-20' | '20+';
export type TripStatus = 'active' | 'closed';
export type PollType = 'destination' | 'dates' | 'budget' | 'custom';
export type PollStatus = 'draft' | 'live' | 'closed' | 'decided';

export interface Profile {
  id: string;
  name: string;
  last_name: string | null;
  email: string;
  phone: string | null;
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
  email: string | null;
  phone: string | null;
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
