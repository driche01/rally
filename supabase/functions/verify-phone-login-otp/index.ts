/**
 * Supabase Edge Function — verify-phone-login-otp
 *
 * POST /verify-phone-login-otp
 * Body: { phone: string, code: string }
 *
 * Companion to `request-phone-login-otp`. Verifies the 6-digit code
 * against the stored hash, then issues a session for the existing
 * account by minting a magic-link `token_hash` via the admin API.
 *
 * Why this can't be a SECURITY DEFINER RPC:
 *   We need `auth.admin.generateLink()` to mint a session for an
 *   existing user. There's no SQL primitive equivalent — issuing a
 *   session requires the admin API. So verification + session
 *   minting both happen here in service-role code.
 *
 * Response (success):
 *   { ok: true, token_hash: string, email: string }
 *
 *   The client takes `token_hash` and calls:
 *     supabase.auth.verifyOtp({ token_hash, type: 'magiclink' })
 *   which mints the session and signs the user in.
 *
 * Response (failure):
 *   { ok: false, reason: 'invalid_code' | 'expired' | 'too_many_attempts' | 'no_account' }
 *
 * Deploy: supabase functions deploy verify-phone-login-otp
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
    return json({ ok: false, error: 'method_not_allowed' }, 405);
  }

  let body: { phone?: string; code?: string };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: 'invalid_json' }, 400);
  }

  const normalized = normalizePhone(body.phone ?? '');
  const code = (body.code ?? '').trim();

  if (!normalized || !/^\d{6}$/.test(code)) {
    return json({ ok: false, reason: 'invalid_code' }, 400);
  }

  const admin = getServiceRoleClient();

  // Look up the latest live token for this phone.
  const { data: token, error: tokenErr } = await admin
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
    await admin
      .from('phone_login_tokens')
      .update({ attempts: token.attempts + 1 })
      .eq('id', token.id);
    return json({ ok: false, reason: 'invalid_code' }, 400);
  }

  // Code valid → burn the token before doing anything else, so a slow
  // failure downstream can't be replayed.
  await admin
    .from('phone_login_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('id', token.id);

  // Resolve the auth user via profiles. Must have an email — that's
  // what generateLink keys on.
  const { data: profile, error: profileErr } = await admin
    .from('profiles')
    .select('id, email')
    .eq('phone', normalized)
    .maybeSingle();

  if (profileErr || !profile?.email) {
    // Defensive: request-phone-login-otp shouldn't have sent a code if
    // there were no profile, but keep this branch for robustness.
    return json({ ok: false, reason: 'no_account' }, 400);
  }

  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: profile.email,
  });
  if (linkErr || !link?.properties?.hashed_token) {
    console.error('[verify-phone-login-otp] generateLink failed:', linkErr?.message);
    return json({ ok: false, error: 'internal' }, 500);
  }

  return json({
    ok: true,
    token_hash: link.properties.hashed_token,
    email:      profile.email,
  });
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
