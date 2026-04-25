/**
 * Supabase Edge Function — claim-otp
 *
 * POST /claim-otp
 * Body: { phone: string }
 *
 * Generates a 6-digit OTP for the phone-to-account claim flow:
 *   1. Normalize phone to E.164.
 *   2. Verify there's an unclaimed `users` row for it (no point sending
 *      a code if there's nothing to claim).
 *   3. Apply rate limit (max 3 sends / 10 min per phone).
 *   4. Generate 6-digit code, hash with sha256(phone:code), insert
 *      `phone_claim_tokens` row with 10-min expiry.
 *   5. Send SMS via Rally's existing Twilio number.
 *
 * Verification + merge happens in the `claim_account_with_otp` SQL RPC
 * (called directly from the client) — keeps SECURITY DEFINER scope
 * tight and lets `auth.uid()` be read internally.
 *
 * Deploy: supabase functions deploy claim-otp
 */

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { normalizePhone } from '../_sms-shared/phone.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 10 min
const RATE_LIMIT_MAX_SENDS = 3;
const OTP_TTL_SECONDS = 10 * 60;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return json({ ok: false, error: 'method_not_allowed' }, 405);
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

  // Sanity check: don't burn a Twilio send if there's nothing to claim.
  const { data: claimable } = await admin.rpc('check_claim_available', {
    p_phone: normalized,
  });
  if (!claimable) {
    // Return 200 + ok=false so callers can't probe whether a phone is
    // claimable (don't leak "is this phone in our system?"). Treat as
    // a successful no-op from the caller's perspective.
    return json({ ok: true, sent: false });
  }

  // Rate limit: count un-expired sends in the window.
  const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
  const { count } = await admin
    .from('phone_claim_tokens')
    .select('id', { count: 'exact', head: true })
    .eq('phone', normalized)
    .gte('created_at', windowStart);

  if ((count ?? 0) >= RATE_LIMIT_MAX_SENDS) {
    return json({ ok: false, error: 'rate_limited' }, 429);
  }

  // Generate code + hash, insert token, send SMS.
  const code = generateOtpCode();
  const codeHash = await sha256Hex(`${normalized}:${code}`);
  const expiresAt = new Date(Date.now() + OTP_TTL_SECONDS * 1000).toISOString();

  const { error: insertError } = await admin.from('phone_claim_tokens').insert({
    phone:      normalized,
    code_hash:  codeHash,
    attempts:   0,
    expires_at: expiresAt,
  });
  if (insertError) {
    console.error('[claim-otp] token insert failed:', insertError.message);
    return json({ ok: false, error: 'internal' }, 500);
  }

  const sent = await sendTwilioSms(
    normalized,
    `Your Rally code: ${code}. Expires in 10 minutes. Reply STOP to opt out.`,
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
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  return createClient(url, key, { auth: { persistSession: false } });
}

function generateOtpCode(): string {
  // 6 digits, leading-zero-padded. Crypto-strong randomness.
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

/**
 * Direct one-shot Twilio send — bypasses the per-thread rate limiter
 * and message-queue logging used by the agent's group-thread sender.
 * Claim OTPs are 1:1 to the user's personal phone, not group threads.
 */
async function sendTwilioSms(toPhone: string, body: string): Promise<boolean> {
  const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID') ?? '';
  const authToken  = Deno.env.get('TWILIO_AUTH_TOKEN') ?? '';
  const fromPhone  = Deno.env.get('TWILIO_PHONE_NUMBER') ?? '';

  if (!accountSid || !authToken || !fromPhone) {
    console.error('[claim-otp] missing Twilio credentials');
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
      console.error(`[claim-otp] Twilio ${res.status}:`, errText.slice(0, 200));
      return false;
    }
    return true;
  } catch (err) {
    console.error('[claim-otp] network error:', err);
    return false;
  }
}
