/**
 * Trip member add/remove API — wraps the member-add / member-remove
 * Supabase Edge Functions. Each one server-side:
 *   1. Authorizes the caller against trips.created_by.
 *   2. Mutates the respondent / participant rows.
 *   3. Fires the corresponding 1:1 SMS (welcome with survey link, or
 *      removed-from-trip notice).
 *
 * The SMS fan-out is server-side so the row update + text message stay
 * consistent — the client doesn't need to chase a separate SMS call.
 */
import { supabase } from '@/lib/supabase';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const MEMBER_ADD_URL = `${SUPABASE_URL}/functions/v1/member-add`;
const MEMBER_REMOVE_URL = `${SUPABASE_URL}/functions/v1/member-remove`;

export interface AddMemberResult {
  ok: boolean;
  reason?: string;
  respondent_id?: string;
  sms_sent?: boolean;
  sms_error?: string | null;
}

export interface RemoveMemberResult {
  ok: boolean;
  reason?: string;
  removed?: { participant: boolean; respondent: boolean };
  sms_sent?: boolean;
  sms_error?: string | null;
}

async function authedFetch<T>(url: string, body: unknown): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) return { ok: false, reason: 'not_authenticated' } as T;
  if (!SUPABASE_URL) return { ok: false, reason: 'misconfigured' } as T;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => null)) as T | null;
    if (!json) return { ok: false, reason: 'server_error' } as T;
    return json;
  } catch {
    return { ok: false, reason: 'network_error' } as T;
  }
}

export async function addTripMember(
  tripId: string,
  phone: string,
  name?: string | null,
): Promise<AddMemberResult> {
  return authedFetch<AddMemberResult>(MEMBER_ADD_URL, {
    trip_id: tripId,
    phone,
    name: name?.trim() || null,
  });
}

export async function removeTripMember(
  tripId: string,
  phone: string,
): Promise<RemoveMemberResult> {
  return authedFetch<RemoveMemberResult>(MEMBER_REMOVE_URL, {
    trip_id: tripId,
    phone,
  });
}
