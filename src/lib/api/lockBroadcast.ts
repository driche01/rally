/**
 * Decision-lock broadcast — shared helper.
 *
 * Used by `approveRecommendation` and `approveRecommendationWithDates` to
 * fan out the lock SMS. Calls the sms-lock-broadcast edge function which
 * splits recipients into responders (standard locked-in body) and
 * holdouts (tailored "the group decided, you haven't responded — let
 * the planner know" body). Keeping the body wording here means every
 * lock path stays consistent.
 */
import { capture, Events } from '@/lib/analytics';
import { supabase } from '@/lib/supabase';
import { getActiveTripSession } from './dashboard';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const LOCK_BROADCAST_URL = `${SUPABASE_URL}/functions/v1/sms-lock-broadcast`;

function summaryUrl(shareToken: string): string {
  const base = process.env.EXPO_PUBLIC_APP_URL ?? 'https://rallysurveys.netlify.app';
  return `${base}/summary/${shareToken}`;
}

/**
 * Build the SMS body for a decision lock. Pure — no side effects when
 * shareToken is omitted (returns body without summary link).
 */
export function buildLockBroadcastBody(
  pollType: string | null,
  lockLabel: string,
  shareToken?: string | null,
): string {
  const noun =
    pollType === 'destination' ? 'destination'
    : pollType === 'dates'     ? 'dates'
    : pollType === 'budget'    ? 'budget'
    : 'plan';
  const link = shareToken ? ` See the full plan: ${summaryUrl(shareToken)}` : '';
  return `Locked in: ${lockLabel} for the ${noun}.${link} Reply to your planner with any questions.`;
}

/**
 * Find the trip's active session and fan out the lock broadcast via the
 * tailored edge function. Best-effort: never throws.
 * Server splits responders (standard body) from holdouts (tailored body).
 */
export async function broadcastDecisionLock(opts: {
  tripId: string;
  pollId?: string;
  pollType: string | null;
  lockLabel: string;
}): Promise<void> {
  try {
    const session = await getActiveTripSession(opts.tripId);
    if (!session) return;

    // Pull share_token so the SMS bodies can link to /summary/ + /respond/.
    let shareToken: string | null = null;
    try {
      const { data } = await supabase
        .from('trips')
        .select('share_token')
        .eq('id', opts.tripId)
        .single();
      shareToken = (data as { share_token?: string } | null)?.share_token ?? null;
    } catch {
      /* fall through */
    }

    const { data: { session: authSession } } = await supabase.auth.getSession();
    const authToken = authSession?.access_token;
    if (!authToken || !SUPABASE_URL) {
      console.warn('[lock-broadcast] not authenticated or misconfigured — skipping fan-out');
      return;
    }

    const res = await fetch(LOCK_BROADCAST_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        trip_session_id: session.id,
        lock_label: opts.lockLabel,
        poll_type: opts.pollType,
        share_token: shareToken,
      }),
    });
    const result = (await res.json().catch(() => null)) as
      | { ok: boolean; sent_responders?: number; sent_holdouts?: number; failed?: number; reason?: string }
      | null;

    capture(Events.LOCK_BROADCAST_SENT, {
      poll_id: opts.pollId ?? null,
      trip_id: opts.tripId,
      trip_session_id: session.id,
      sent_responders: result?.sent_responders ?? 0,
      sent_holdouts: result?.sent_holdouts ?? 0,
      failed: result?.failed ?? 0,
      ok: result?.ok ?? false,
      tailored: true,
    });
  } catch (err) {
    console.warn('[lock-broadcast] failed:', err);
  }
}
