/**
 * Resolve inbound SMS senders to their trip-session(s) + planner info,
 * and a generic helper for pushing to a planner's Expo devices.
 *
 * Phase 15: Rally no longer relays member→planner SMS into a dashboard
 * inbox. The previous `notifyPlannerOfInbound` push-fan-out is gone.
 * `resolveInboundMatches` survives because the inbound-processor still
 * needs to know which trip session(s) an inbound row belongs to (for
 * threading + diagnostics) and `buildRedirectBody` still names the
 * planner so the member knows who to text directly.
 */

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

export interface PlannerInboundMatch {
  trip_session_id: string;
  trip_id: string | null;
  participant_id: string;
  participant_name: string | null;
  planner_user_id: string | null;
  planner_name: string | null;
}

/**
 * Look up active trip sessions for a sender phone. A phone may be in more
 * than one active session — return all matches; caller fans out.
 */
export async function resolveInboundMatches(
  admin: SupabaseClient,
  senderPhone: string,
): Promise<PlannerInboundMatch[]> {
  const { data, error } = await admin.rpc('resolve_inbound_for_planner', {
    p_phone: senderPhone,
  });
  if (error) {
    console.error('[planner-notify] resolve failed:', error.message);
    return [];
  }
  const payload = (data as { matches?: PlannerInboundMatch[] } | null) ?? null;
  return payload?.matches ?? [];
}

/**
 * Generic Expo push to a planner's devices. Best-effort, never throws.
 * Returns the count of pushes attempted.
 */
export async function pushToPlanner(
  admin: SupabaseClient,
  plannerUserId: string,
  push: { title: string; body: string; data?: Record<string, unknown> },
): Promise<number> {
  if (!plannerUserId) return 0;
  const { data: tokens } = await admin
    .from('push_tokens')
    .select('token')
    .eq('user_id', plannerUserId);
  const tokenList = (tokens ?? []).map((t: { token: string }) => t.token);
  if (tokenList.length === 0) return 0;

  const messages = tokenList.map((token: string) => ({
    to: token,
    title: push.title,
    body: push.body,
    sound: 'default',
    data: push.data ?? {},
  }));

  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
      },
      body: JSON.stringify(messages),
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error(`[planner-notify] generic push failed (${res.status}):`, errText.slice(0, 200));
      return 0;
    }
  } catch (err) {
    console.error('[planner-notify] generic push transport error:', err);
    return 0;
  }
  return tokenList.length;
}

/**
 * Build the redirect SMS body. Rally doesn't relay messages to the
 * planner anymore (Phase 15) — so the redirect tells the member to
 * reach the planner directly. We name the planner when we know them
 * so the member has a concrete human to text.
 *
 * Multiple-planner case: if more than one match comes back, prefer the
 * first known planner name. The redirect is a hint, not a directory.
 */
export function buildRedirectBody(
  matches: PlannerInboundMatch[],
  surveyUrl: string | null = null,
): string {
  const named = matches.find((m) => m.planner_name && m.planner_name.trim());
  if (named) {
    const first = (named.planner_name ?? '').trim().split(/\s+/)[0];
    const lead = `Thanks for the message — I'm Rally, a bot, so I can't pass it along. Text ${first} directly if you need them.`;
    return surveyUrl ? `${lead} To update your answers: ${surveyUrl}` : lead;
  }
  // Unknown sender — keep the legacy redirect.
  return (
    "I'm Rally — I help groups plan trips. " +
    "If a friend invited you, tap their link to join. " +
    "To start a trip, ask the friend who invited you for a sign-up link. " +
    "Reply STOP to opt out."
  );
}
