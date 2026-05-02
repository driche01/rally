/**
 * Supabase Edge Function — verify-phone-change-otp
 *
 * POST /verify-phone-change-otp
 * Authorization: Bearer <user JWT>
 * Body: { phone: string, code: string }
 *
 * Companion to request-phone-change-otp. Validates the 6-digit code
 * against phone_login_tokens, then writes the new phone to:
 *   1. profiles.phone — the source of truth Rally reads from everywhere.
 *   2. auth.users.phone — kept in sync via the admin API so flows like
 *      app_create_sms_session that fall back to auth.users.phone don't
 *      see a stale value.
 *
 * Same anti-replay posture as the login OTP: token is burned (used_at
 * set) the moment the hash matches, before downstream writes.
 *
 * Returns:
 *   { ok: true }
 *   { ok: false, reason: 'invalid_code' | 'expired' | 'too_many_attempts'
 *                       | 'invalid_auth' | 'phone_in_use' }
 */

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { normalizePhone } from '../_sms-shared/phone.ts';
import { getServiceRoleKey } from '../_sms-shared/api-keys.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MAX_ATTEMPTS = 5;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return json({ ok: false, reason: 'method_not_allowed' }, 405);
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  const userJwt = authHeader.replace(/^Bearer\s+/i, '');
  if (!userJwt) {
    return json({ ok: false, reason: 'invalid_auth' }, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const adminClient = getServiceRoleClient();

  // Resolve the caller via the admin client + the user's JWT — passing
  // the JWT as the second arg to getUser() bypasses the JWT-format check
  // the gateway would otherwise apply (sb_publishable_* keys aren't JWTs).
  const { data: userData, error: userErr } = await adminClient.auth.getUser(userJwt);
  if (userErr || !userData?.user) {
    return json({ ok: false, reason: 'invalid_auth' }, 401);
  }
  const authUserId = userData.user.id;

  let body: { phone?: string; code?: string };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, reason: 'invalid_json' }, 400);
  }
  const normalized = normalizePhone(body.phone ?? '');
  const code = (body.code ?? '').trim();
  if (!normalized || !/^\d{6}$/.test(code)) {
    return json({ ok: false, reason: 'invalid_code' }, 400);
  }

  // Look up the latest live token for this phone.
  const { data: token, error: tokenErr } = await adminClient
    .from('phone_login_tokens')
    .select('id, code_hash, attempts, expires_at, used_at')
    .eq('phone', normalized)
    .is('used_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (tokenErr || !token) {
    return json({ ok: false, reason: 'invalid_code' }, 400);
  }
  if (new Date(token.expires_at).getTime() < Date.now()) {
    return json({ ok: false, reason: 'expired' }, 400);
  }
  if (token.attempts >= MAX_ATTEMPTS) {
    return json({ ok: false, reason: 'too_many_attempts' }, 429);
  }

  const expectedHash = await sha256Hex(`${normalized}:${code}`);
  if (expectedHash !== token.code_hash) {
    await adminClient
      .from('phone_login_tokens')
      .update({ attempts: token.attempts + 1 })
      .eq('id', token.id);
    return json({ ok: false, reason: 'invalid_code' }, 400);
  }

  // Burn the token first so a slow downstream write can't be replayed.
  await adminClient
    .from('phone_login_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('id', token.id);

  // Reject if another account already owns this phone.
  const { data: clash } = await adminClient
    .from('profiles')
    .select('id')
    .eq('phone', normalized)
    .neq('id', authUserId)
    .maybeSingle();
  if (clash) {
    return json({ ok: false, reason: 'phone_in_use' }, 409);
  }

  // Write the new phone to both surfaces. Profiles is the source of
  // truth; auth.users.phone is kept in sync so legacy fallbacks pick
  // up the right value.
  const { error: profileErr } = await adminClient
    .from('profiles')
    .update({ phone: normalized })
    .eq('id', authUserId);
  if (profileErr) {
    console.error('[verify-phone-change-otp] profile update failed:', profileErr.message);
    return json({ ok: false, reason: 'profile_write_failed' }, 500);
  }

  const { error: authUpdateErr } = await adminClient.auth.admin.updateUserById(authUserId, {
    phone: normalized,
    phone_confirm: true,
  });
  if (authUpdateErr) {
    // Non-fatal — profiles is already updated. Log so we can see it.
    console.warn('[verify-phone-change-otp] auth.users.phone sync failed:', authUpdateErr.message);
  }

  return json({ ok: true });
});

// ─── helpers ────────────────────────────────────────────────────────────────

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

function getServiceRoleClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const key = getServiceRoleKey();
  return createClient(url, key, { auth: { persistSession: false } });
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hashBuf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
