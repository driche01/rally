import { supabase } from '../supabase';
import type { LodgingOption, LodgingVote, LodgingOptionWithVotes, LodgingPlatform } from '../../types/database';

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export interface CreateLodgingInput {
  trip_id: string;
  platform: LodgingPlatform;
  title: string;
  url?: string | null;
  notes?: string | null;
  check_in_date?: string | null;
  check_out_date?: string | null;
  check_in_time?: string | null;
  check_out_time?: string | null;
  total_cost_cents?: number | null;
  nightly_rate_cents?: number | null;
  position?: number;
}

export async function getLodgingOptionsForTrip(
  tripId: string
): Promise<LodgingOptionWithVotes[]> {
  const { data: options, error: optErr } = await supabase
    .from('lodging_options')
    .select('*')
    .eq('trip_id', tripId)
    .order('position', { ascending: true });
  if (optErr) throw optErr;

  const { data: votes, error: voteErr } = await supabase
    .from('lodging_votes')
    .select('*')
    .eq('trip_id', tripId);
  if (voteErr) throw voteErr;

  return (options ?? []).map((opt) => {
    const optVotes = (votes ?? []).filter((v) => v.lodging_option_id === opt.id);
    return { ...opt, votes: optVotes, voteCount: optVotes.length };
  });
}

export async function createLodgingOption(
  input: CreateLodgingInput
): Promise<LodgingOption> {
  const { data, error } = await supabase
    .from('lodging_options')
    .insert(input)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateLodgingOption(
  optionId: string,
  updates: Partial<Omit<CreateLodgingInput, 'trip_id'>> & {
    status?: LodgingOption['status'];
    booking_confirmation?: string | null;
  }
): Promise<LodgingOption> {
  const { data, error } = await supabase
    .from('lodging_options')
    .update(updates)
    .eq('id', optionId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteLodgingOption(optionId: string): Promise<void> {
  const { error } = await supabase
    .from('lodging_options')
    .delete()
    .eq('id', optionId);
  if (error) throw error;
}

export async function confirmLodgingBooking(
  optionId: string,
  details: {
    booking_confirmation?: string;
    check_in_time?: string;
    check_out_time?: string;
    total_cost_cents?: number;
  }
): Promise<LodgingOption> {
  return updateLodgingOption(optionId, { ...details, status: 'booked' });
}

// ─── Voting ───────────────────────────────────────────────────────────────────

export async function addLodgingVote(
  lodgingOptionId: string,
  tripId: string,
  respondentId: string
): Promise<LodgingVote> {
  const { data, error } = await supabase
    .from('lodging_votes')
    .insert({ lodging_option_id: lodgingOptionId, trip_id: tripId, respondent_id: respondentId })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function removeLodgingVote(
  lodgingOptionId: string,
  respondentId: string
): Promise<void> {
  const { error } = await supabase
    .from('lodging_votes')
    .delete()
    .eq('lodging_option_id', lodgingOptionId)
    .eq('respondent_id', respondentId);
  if (error) throw error;
}

// ─── Deep-link URL parsing ────────────────────────────────────────────────────
//
// Note: the matching client-side URL *builders* lived here pre-cache. They
// were retired when per-suggestion deep-links moved server-side into
// `suggest-lodging` (which mirrors the Airbnb/VRBO/Booking formats inline).
// Parsing the planner's pasted URLs still happens here.

/**
 * Parses a pasted Airbnb/VRBO/Booking.com listing URL and extracts the platform
 * and a clean shareable link. Returns null if the URL isn't recognised.
 */
export function parseLodgingUrl(
  url: string
): { platform: LodgingPlatform; cleanUrl: string; titleSlug?: string } | null {
  try {
    const parsed = new URL(url.trim());
    const host = parsed.hostname.replace('www.', '');

    if (host === 'airbnb.com') {
      const match = parsed.pathname.match(/\/rooms\/(\d+)/);
      if (!match) return null;
      return {
        platform: 'airbnb',
        cleanUrl: `https://www.airbnb.com/rooms/${match[1]}`,
        titleSlug: undefined,
      };
    }

    if (host === 'vrbo.com') {
      const match = parsed.pathname.match(/\/(\d+)p?/);
      if (!match) return null;
      return {
        platform: 'vrbo',
        cleanUrl: `https://www.vrbo.com${parsed.pathname.split('?')[0]}`,
        titleSlug: undefined,
      };
    }

    if (host === 'booking.com') {
      // Booking.com listing URLs: /hotel/xx/slug.html
      const match = parsed.pathname.match(/\/hotel\/[^/]+\/([^.]+)/);
      return {
        platform: 'booking',
        cleanUrl: `https://www.booking.com${parsed.pathname.split('?')[0]}`,
        titleSlug: match ? match[1].replace(/-/g, ' ') : undefined,
      };
    }

    return null;
  } catch {
    return null;
  }
}

/** Formats cents as "$1,234.56" */
export function formatCents(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100);
}
