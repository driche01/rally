/**
 * Join-link client API (1:1 SMS pivot, Phase 1).
 *
 * - getJoinLinkPreview: anon-callable, fetches what the /join/[code] page renders.
 * - submitJoinLink:     anon-callable, posts the form to sms-join-submit edge fn.
 * - createJoinLink:     authenticated, called by planners (dashboard / simulator).
 */

import { supabase } from '@/lib/supabase';
import type { JoinLinkPreview } from '@/types/database';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
const SUBMIT_URL = `${SUPABASE_URL}/functions/v1/sms-join-submit`;

const JOIN_BASE_URL = 'https://rallysurveys.netlify.app/join';

export type SubmitJoinLinkReason =
  | 'sent'
  | 'duplicate_recent'
  | 'already_joined'
  | 'invalid_code'
  | 'expired'
  | 'revoked'
  | 'capacity_reached'
  | 'invalid_phone'
  | 'rate_limited'
  | 'sms_send_failed'
  | 'missing_fields'
  | 'field_too_long'
  | 'server_error';

export interface SubmitJoinLinkResult {
  ok: boolean;
  reason: SubmitJoinLinkReason;
  planner_name?: string | null;
  destination?: string | null;
  dates?: { start?: string; end?: string } | null;
  joined_names?: string[];
  member_count?: number;
}

export async function getJoinLinkPreview(code: string): Promise<JoinLinkPreview> {
  const { data, error } = await supabase.rpc('get_join_link_preview', { p_code: code });
  if (error || !data) {
    return {
      ok: false,
      reason: error?.message ?? 'unknown',
      planner_name: null,
      destination: null,
      dates: null,
      joined_names: [],
      member_count: 0,
    };
  }
  const d = data as JoinLinkPreview;
  return {
    ok: !!d.ok,
    reason: d.reason,
    planner_name: d.planner_name ?? null,
    destination: d.destination ?? null,
    dates: d.dates ?? null,
    joined_names: d.joined_names ?? [],
    member_count: d.member_count ?? 0,
  };
}

export interface SubmitJoinLinkArgs {
  code: string;
  phone: string;
  displayName: string;
  email?: string | null;
}

export async function submitJoinLink(args: SubmitJoinLinkArgs): Promise<SubmitJoinLinkResult> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return { ok: false, reason: 'server_error' };
  }
  try {
    const res = await fetch(SUBMIT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        apikey: SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        code: args.code,
        phone: args.phone,
        display_name: args.displayName,
        email: args.email ?? null,
      }),
    });
    const json = (await res.json().catch(() => null)) as SubmitJoinLinkResult | null;
    if (!json) return { ok: false, reason: 'server_error' };
    return json;
  } catch {
    return { ok: false, reason: 'server_error' };
  }
}

/**
 * Authenticated planner-side: create a join link for a trip session.
 * Returns the share URL the planner forwards to friends.
 */
export async function createJoinLink(
  tripSessionId: string,
): Promise<{ ok: boolean; code?: string; url?: string; reason?: string }> {
  const { data, error } = await supabase.rpc('create_join_link', {
    p_trip_session_id: tripSessionId,
  });
  if (error) return { ok: false, reason: error.message };
  const d = data as { ok: boolean; code?: string; reason?: string };
  if (!d.ok || !d.code) return { ok: false, reason: d.reason ?? 'unknown' };
  return { ok: true, code: d.code, url: `${JOIN_BASE_URL}/${d.code}` };
}
