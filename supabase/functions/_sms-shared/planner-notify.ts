/**
 * Planner-attention notifier for inbound participant SMS.
 *
 * Under the post-pivot model, inbound SMS that isn't a recognized command
 * (STOP, REJOIN, JOIN_YES, APP, claim-OTP echo) gets a soft auto-redirect
 * back to the planner. The planner needs to *see* what the participant
 * said — otherwise messages that need follow-up disappear into the redirect.
 *
 * This module:
 *   1. Resolves a sender phone to its active trip session(s) and planner(s)
 *   2. Returns the planner names for inclusion in the redirect SMS body
 *   3. Fans out an Expo push notification to each planner's registered
 *      devices with the participant's name + first ~60 chars of the body
 *
 * The caller is responsible for setting needs_planner_attention=true on
 * the thread_messages row(s) so the dashboard inbox surfaces them.
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
 * Send an Expo push to each planner device. Best-effort, never throws.
 * Returns the count of pushes attempted (zero if planner has no tokens).
 */
export async function notifyPlannerOfInbound(
  admin: SupabaseClient,
  match: PlannerInboundMatch,
  body: string,
): Promise<number> {
  if (!match.planner_user_id) return 0;

  const { data: tokens, error: tokErr } = await admin
    .from('push_tokens')
    .select('token')
    .eq('user_id', match.planner_user_id);
  if (tokErr) {
    console.error('[planner-notify] push_tokens lookup failed:', tokErr.message);
    return 0;
  }
  const tokenList = (tokens ?? []).map((t: { token: string }) => t.token);
  if (tokenList.length === 0) return 0;

  const senderLabel = match.participant_name ?? 'Someone';
  const preview = body.length > 60 ? body.slice(0, 57) + '...' : body;
  const messages = tokenList.map((token: string) => ({
    to: token,
    title: `${senderLabel} replied`,
    body: preview,
    sound: 'default',
    data: {
      screen: match.trip_id ? `/(app)/trips/${match.trip_id}/members` : '/(app)/(tabs)',
      type: 'inbound_reply',
      trip_id: match.trip_id,
      trip_session_id: match.trip_session_id,
    },
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
      console.error(`[planner-notify] Expo push failed (${res.status}):`, errText.slice(0, 200));
      return 0;
    }
  } catch (err) {
    console.error('[planner-notify] push transport error:', err);
    return 0;
  }
  return tokenList.length;
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
 * Build the redirect SMS body. If we know which planner owns the trip,
 * name them so the participant has a real human to reach out to.
 *
 * Multiple-planner case: if more than one match comes back, prefer the
 * first known planner name. The redirect is a hint, not a directory.
 */
export function buildRedirectBody(matches: PlannerInboundMatch[]): string {
  const named = matches.find((m) => m.planner_name && m.planner_name.trim());
  if (named) {
    const first = (named.planner_name ?? '').trim().split(/\s+/)[0];
    return (
      `Thanks for the message. I'm Rally — I just send the survey links and reminders, ` +
      `I don't have a way to chat back. For trip questions, reach out to ${first} directly. ` +
      `To update your survey answers, tap the most recent survey link I sent. Reply STOP to opt out.`
    );
  }
  // Unknown sender — keep the legacy redirect.
  // TODO: restore "rallysurveys.netlify.app" mention once a custom domain
  // replaces it (carriers filter free-tier hosts; see templates.ts).
  return (
    "I'm Rally — I help groups plan trips. " +
    "If a friend invited you, tap their link to join. " +
    "To start a trip, ask the friend who invited you for a sign-up link. " +
    "Reply STOP to opt out."
  );
}
