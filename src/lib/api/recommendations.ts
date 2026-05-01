/**
 * Decision queue — poll_recommendations API.
 *
 * Migration 048 ships three SECURITY DEFINER RPCs that gate on
 * trip_membership. The dashboard "Pending Decisions" card consumes
 * `getPendingRecommendations`; the per-row approve/hold buttons call
 * `approveRecommendation` / `holdRecommendation`.
 *
 * Approval also broadcasts the lock SMS (best-effort) so participants
 * find out via 1:1 SMS without a separate planner action.
 */
import { supabase } from '@/lib/supabase';
import type { PollOption } from '@/types/database';
import { broadcastDecisionLock } from './lockBroadcast';
import { capture, Events } from '@/lib/analytics';

export type RecommendationStatus =
  | 'pending' | 'approved' | 'edited' | 'locked' | 'held' | 'superseded';

export interface PollRecommendation {
  id: string;
  poll_id: string;
  trip_id: string;
  recommended_option_id: string | null;
  recommendation_text: string;
  vote_breakdown: Record<string, number>;
  holdout_participant_ids: string[];
  confidence: number | null;
  status: RecommendationStatus;
  locked_value: string | null;
  hold_until: string | null;
  planner_action_at: string | null;
  created_at: string;
  // Joined-in metadata for the dashboard card
  poll_title: string | null;
  poll_type: string | null;
  poll_options: PollOption[];
}

/**
 * Pending + held recommendations across every poll on a trip. The
 * dashboard pinned card filters to status='pending' for the unread
 * count, but we surface 'held' too so they don't disappear from view.
 */
export async function getPendingRecommendations(tripId: string): Promise<PollRecommendation[]> {
  if (!tripId) return [];
  const { data, error } = await supabase
    .from('poll_recommendations')
    .select(`
      id, poll_id, trip_id, recommended_option_id, recommendation_text,
      vote_breakdown, holdout_participant_ids, confidence, status,
      locked_value, hold_until, planner_action_at, created_at,
      polls!poll_recommendations_poll_id_fkey (
        title, type,
        poll_options!poll_options_poll_id_fkey ( id, label, position )
      )
    `)
    .eq('trip_id', tripId)
    .in('status', ['pending', 'held', 'approved', 'edited'])
    .order('created_at', { ascending: false });
  if (error) {
    console.warn('[recommendations] fetch failed:', error.message);
    return [];
  }
  type Row = Omit<PollRecommendation, 'poll_title' | 'poll_type' | 'poll_options'> & {
    polls: { title: string; type: string; poll_options: PollOption[] } | null;
  };
  return ((data ?? []) as unknown as Row[]).map((r) => ({
    id: r.id,
    poll_id: r.poll_id,
    trip_id: r.trip_id,
    recommended_option_id: r.recommended_option_id,
    recommendation_text: r.recommendation_text,
    vote_breakdown: r.vote_breakdown,
    holdout_participant_ids: r.holdout_participant_ids,
    confidence: r.confidence,
    status: r.status,
    locked_value: r.locked_value,
    hold_until: r.hold_until,
    planner_action_at: r.planner_action_at,
    created_at: r.created_at,
    poll_title: r.polls?.title ?? null,
    poll_type: r.polls?.type ?? null,
    poll_options: (r.polls?.poll_options ?? []).sort((a, b) => a.position - b.position),
  }));
}

export async function requestRecommendation(pollId: string): Promise<{ ok: boolean; recommendation_id?: string; reason?: string }> {
  const { data, error } = await supabase.rpc('request_poll_recommendation', { p_poll_id: pollId });
  if (error) return { ok: false, reason: error.message };
  return data as { ok: boolean; recommendation_id?: string; reason?: string };
}

/**
 * Approve a recommendation: marks the underlying poll decided, then
 * fans out the lock-broadcast SMS to active participants. SMS is
 * best-effort — the lock succeeds even if the broadcast fails.
 */
export async function approveRecommendation(
  recommendationId: string,
  overrideOptionId?: string | null,
): Promise<{ ok: boolean; lock_label?: string; reason?: string }> {
  const { data, error } = await supabase.rpc('approve_poll_recommendation', {
    p_recommendation_id: recommendationId,
    p_override_option_id: overrideOptionId ?? null,
  });
  if (error) return { ok: false, reason: error.message };
  const result = data as {
    ok: boolean; reason?: string;
    poll_id?: string; option_id?: string; lock_label?: string;
    status?: string; poll_type?: string;
  };
  if (!result.ok) return { ok: false, reason: result.reason };

  capture(Events.RECOMMENDATION_APPROVED, {
    recommendation_id: recommendationId,
    poll_id: result.poll_id,
    overridden: Boolean(overrideOptionId),
    status: result.status,
  });

  // Best-effort lock broadcast — fire-and-forget so the planner's
  // dashboard flips to "Just locked" the moment the RPC returns instead
  // of waiting on Twilio fan-out (which can take a few seconds per
  // participant). Failures are logged; they don't block the UX.
  if (result.poll_id && result.lock_label) {
    const pollId = result.poll_id;
    const lockLabel = result.lock_label;
    const pollType = result.poll_type ?? null;
    (async () => {
      try {
        const { data: poll } = await supabase
          .from('polls')
          .select('trip_id')
          .eq('id', pollId)
          .single();
        if (poll?.trip_id) {
          await broadcastDecisionLock({
            tripId: poll.trip_id,
            pollId,
            pollType,
            lockLabel,
          });
        }
      } catch (err) {
        console.warn('[recommendations] post-approve broadcast failed:', err);
      }
    })();
  }

  return { ok: true, lock_label: result.lock_label };
}

/**
 * Approve a dates-poll recommendation with a planner-picked array of
 * ISO dates from a calendar. Locks the poll, writes
 * trips.start_date/end_date from min/max of picks, and broadcasts the
 * lock SMS. See migration 061 for the RPC contract.
 */
export async function approveRecommendationWithDates(
  recommendationId: string,
  dates: string[],
): Promise<{ ok: boolean; lock_label?: string; reason?: string }> {
  if (dates.length === 0) return { ok: false, reason: 'no_dates' };
  const { data, error } = await supabase.rpc('approve_poll_recommendation_with_dates', {
    p_recommendation_id: recommendationId,
    p_dates: dates,
  });
  if (error) return { ok: false, reason: error.message };
  const result = data as {
    ok: boolean; reason?: string;
    poll_id?: string; option_id?: string | null; lock_label?: string;
    status?: string; poll_type?: string;
    start_date?: string; end_date?: string;
  };
  if (!result.ok) return { ok: false, reason: result.reason };

  capture(Events.RECOMMENDATION_APPROVED, {
    recommendation_id: recommendationId,
    poll_id: result.poll_id,
    overridden: true,
    status: result.status,
    pick_count: dates.length,
  });

  if (result.poll_id && result.lock_label) {
    const pollId = result.poll_id;
    const lockLabel = result.lock_label;
    const pollType = result.poll_type ?? 'dates';
    // Fire-and-forget the SMS fan-out so the dashboard flips to
    // "Just locked" instantly. See approveRecommendation for context.
    (async () => {
      try {
        const { data: poll } = await supabase
          .from('polls')
          .select('trip_id')
          .eq('id', pollId)
          .single();
        if (poll?.trip_id) {
          await broadcastDecisionLock({
            tripId: poll.trip_id,
            pollId,
            pollType,
            lockLabel,
          });
        }
      } catch (err) {
        console.warn('[recommendations] post-approve-with-dates broadcast failed:', err);
      }
    })();
  }

  return { ok: true, lock_label: result.lock_label };
}

/**
 * Undo a recently-approved lock. Server enforces a 5-minute grace
 * window; outside that window returns reason='grace_expired'.
 */
export async function undoPollLock(
  recommendationId: string,
): Promise<{ ok: boolean; reason?: string; age_seconds?: number }> {
  const { data, error } = await supabase.rpc('undo_poll_lock', {
    p_recommendation_id: recommendationId,
  });
  if (error) return { ok: false, reason: error.message };
  return data as { ok: boolean; reason?: string; age_seconds?: number };
}

export async function holdRecommendation(
  recommendationId: string,
  holdUntil?: string | null,
): Promise<{ ok: boolean; reason?: string }> {
  const { data, error } = await supabase.rpc('hold_poll_recommendation', {
    p_recommendation_id: recommendationId,
    p_hold_until: holdUntil ?? null,
  });
  if (error) return { ok: false, reason: error.message };
  const result = data as { ok: boolean; reason?: string };
  if (result.ok) {
    capture(Events.RECOMMENDATION_HELD, {
      recommendation_id: recommendationId,
      hold_until: holdUntil ?? null,
    });
  }
  return result;
}
