/**
 * 1:1 SMS sender — Twilio REST API → single recipient.
 *
 * Built for the 1:1 pivot. Phase 1 uses it for the join-link confirmation
 * + kickoff SMS. Phase 3 will compose this into a `broadcast()` helper for
 * planner fan-out.
 *
 * Behaviors:
 *  - Per-phone in-memory rate limit (1 msg / 3s) — same intent as the
 *    legacy group sender's per-thread limiter, just keyed differently.
 *  - Single retry with 5s backoff on transport failure.
 *  - Logs every successful send to thread_messages with a 1:1 thread_id.
 *  - Returns the Twilio SID + a normalized error string for the caller.
 */

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

const lastSendAt = new Map<string, number>();

export interface SendDmOptions {
  /** Trip session this DM belongs to (for thread_messages.trip_session_id). */
  tripSessionId?: string | null;
  /**
   * Optional idempotency key. Phase 3 fan-out uses this; Phase 1 leaves it
   * unset. When set, two calls with the same key for the same toPhone within
   * 60s no-op the second send (returns the prior result).
   */
  idempotencyKey?: string;
  /** Override the sender_role logged on the outbound row (default 'rally'). */
  senderRole?: string;
}

export interface SendDmResult {
  sid: string | null;
  error: string | null;
}

const idempotencyCache = new Map<string, { result: SendDmResult; ts: number }>();

export async function sendDm(
  admin: SupabaseClient,
  toPhone: string,
  body: string,
  opts: SendDmOptions = {},
): Promise<SendDmResult> {
  if (!toPhone || !body) {
    return { sid: null, error: 'missing_args' };
  }

  if (opts.idempotencyKey) {
    const cacheKey = `${toPhone}:${opts.idempotencyKey}`;
    const cached = idempotencyCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < 60_000) {
      return cached.result;
    }
  }

  const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID') ?? '';
  const authToken  = Deno.env.get('TWILIO_AUTH_TOKEN')  ?? '';
  const fromPhone  = Deno.env.get('TWILIO_PHONE_NUMBER') ?? '';

  if (!accountSid || !authToken || !fromPhone) {
    console.error('[dm-sender] missing Twilio credentials');
    return { sid: null, error: 'missing_credentials' };
  }

  // Per-phone rate limit: 1 msg / 3s
  const last = lastSendAt.get(toPhone) ?? 0;
  const elapsed = Date.now() - last;
  if (elapsed < 3000) {
    await new Promise((r) => setTimeout(r, 3000 - elapsed));
  }

  const url  = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const auth = btoa(`${accountSid}:${authToken}`);

  const attempt = async (): Promise<SendDmResult> => {
    try {
      const params = new URLSearchParams({ From: fromPhone, To: toPhone, Body: body });
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });
      lastSendAt.set(toPhone, Date.now());
      if (res.ok) {
        const data = await res.json();
        return { sid: data.sid as string, error: null };
      }
      const errText = await res.text();
      console.error(`[dm-sender] Twilio ${res.status}:`, errText.slice(0, 200));
      return { sid: null, error: `twilio_${res.status}` };
    } catch (err) {
      console.error('[dm-sender] network error:', err);
      return { sid: null, error: 'network_error' };
    }
  };

  let result = await attempt();
  if (result.error) {
    await new Promise((r) => setTimeout(r, 5000));
    result = await attempt();
  }

  if (result.sid) {
    const threadId = `1to1_${toPhone}`;
    await admin.from('thread_messages').insert({
      thread_id: threadId,
      trip_session_id: opts.tripSessionId ?? null,
      direction: 'outbound',
      sender_phone: null,
      sender_role: opts.senderRole ?? 'rally',
      body,
      message_sid: result.sid,
    });
  }

  if (opts.idempotencyKey) {
    const cacheKey = `${toPhone}:${opts.idempotencyKey}`;
    idempotencyCache.set(cacheKey, { result, ts: Date.now() });
  }

  return result;
}
