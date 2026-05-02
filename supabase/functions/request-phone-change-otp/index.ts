/**
 * Supabase Edge Function — request-phone-change-otp
 *
 * POST /request-phone-change-otp
 * Authorization: Bearer <user JWT>
 * Body: { phone: string }
 *
 * Sends a 6-digit code to a new phone number for an already-authenticated
 * user (e.g. a Google-signed-up user adding their phone for the first
 * time, or anyone editing their phone via the Account screen).
 *
 * Why this instead of supabase.auth.updateUser({ phone })? Supabase's
 * native phone auth requires the project to have a phone provider
 * (Twilio/MessageBird) configured in its Auth dashboard. Rally already
 * uses Twilio for every other SMS (trip nudges, member-add welcomes,
 * login OTP), so this function piggybacks on that pipeline and avoids
 * the second-Twilio-config requirement entirely.
 *
 * Mirrors the request-phone-login-otp flow:
 *   1. Resolve the caller's user_id from the JWT (must be authed).
 *   2. Validate + normalize the new phone.
 *   3. Rate limit (3 sends / 10 min per phone).
 *   4. Generate code, hash with sha256(phone:code), insert
 *      phone_login_tokens row with 10-min TTL.
 *   5. Send SMS via Rally's Twilio number.
 *
 * Verification + profile mutation happens in verify-phone-change-otp.
 */

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { normalizePhone } from '../_sms-shared/phone.ts';
import { getServiceRoleKey } from '../_sms-shared/api-keys.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX_SENDS = 3;
const OTP_TTL_SECONDS = 10 * 60;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return json({ ok: false, error: 'method_not_allowed' }, 405);
  }

  // Auth gate — caller must be a logged-in user. The JWT comes through
  // the Authorization header; supabase-js extracts the user via getUser.
  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) {
    return json({ ok: false, error: 'missing_auth' }, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const userClient = createClient(supabaseUrl, getServiceRoleKey(), {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser(token);
  if (userErr || !userData?.user) {
    return json({ ok: false, error: 'invalid_auth' }, 401);
  }

  let body: { phone?: string };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: 'invalid_json' }, 400);
  }

  const normalized = normalizePhone(body.phone ?? '');
  if (!normalized) {
    return json({ ok: false, error: 'invalid_phone' }, 400);
  }

  const admin = getServiceRoleClient();

  // Rate limit before SMS send. Same per-phone window as login OTP.
  const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
  const { count } = await admin
    .from('phone_login_tokens')
    .select('id', { count: 'exact', head: true })
    .eq('phone', normalized)
    .gte('created_at', windowStart);

  if ((count ?? 0) >= RATE_LIMIT_MAX_SENDS) {
    return json({ ok: false, error: 'rate_limited' }, 429);
  }

  const code = generateOtpCode();
  const codeHash = await sha256Hex(`${normalized}:${code}`);
  const expiresAt = new Date(Date.now() + OTP_TTL_SECONDS * 1000).toISOString();

  const { error: insertError } = await admin.from('phone_login_tokens').insert({
    phone:      normalized,
    code_hash:  codeHash,
    attempts:   0,
    expires_at: expiresAt,
  });
  if (insertError) {
    console.error('[request-phone-change-otp] token insert failed:', insertError.message);
    return json({ ok: false, error: 'internal' }, 500);
  }

  const sent = await sendTwilioSms(
    normalized,
    `Your Rally verification code: ${code}. Expires in 10 minutes. Reply STOP to opt out.`,
  );
  if (!sent) {
    return json({ ok: false, error: 'send_failed' }, 502);
  }

  return json({ ok: true, sent: true });
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

function generateOtpCode(): string {
  const buf = new Uint8Array(4);
  crypto.getRandomValues(buf);
  const n = (buf[0] << 24 | buf[1] << 16 | buf[2] << 8 | buf[3]) >>> 0;
  return String(n % 1_000_000).padStart(6, '0');
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hashBuf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function sendTwilioSms(toPhone: string, body: string): Promise<boolean> {
  const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID') ?? '';
  const authToken  = Deno.env.get('TWILIO_AUTH_TOKEN') ?? '';
  const fromPhone  = Deno.env.get('TWILIO_PHONE_NUMBER') ?? '';

  if (!accountSid || !authToken || !fromPhone) {
    console.error('[request-phone-change-otp] missing Twilio credentials');
    return false;
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const auth = btoa(`${accountSid}:${authToken}`);
  const params = new URLSearchParams({ From: fromPhone, To: toPhone, Body: body });

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error(`[request-phone-change-otp] Twilio ${res.status}:`, errText.slice(0, 200));
      return false;
    }
    return true;
  } catch (err) {
    console.error('[request-phone-change-otp] network error:', err);
    return false;
  }
}
