/**
 * Component 12: TwilioSender
 *
 * Outbound MMS delivery from the Rally bot number.
 * All sends go to the group thread, never to individuals directly.
 *
 * Features:
 *   - Per-thread rate limit (1 msg / 3 sec)
 *   - Retry once on failure with 5-sec backoff
 *   - Zombie session detection (3 consecutive failures = ABANDONED)
 *   - All outbound logged to thread_messages
 */

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

// In-memory per-thread timestamp for rate limiting
const lastSendTime = new Map<string, number>();

/**
 * Send an MMS message to a group thread via Twilio.
 * Returns the Twilio MessageSid on success, or null on failure.
 */
export async function sendSms(
  admin: SupabaseClient,
  sessionId: string,
  threadId: string,
  recipientPhones: string[],
  body: string,
): Promise<string | null> {
  const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID') ?? '';
  const authToken = Deno.env.get('TWILIO_AUTH_TOKEN') ?? '';
  const fromPhone = Deno.env.get('TWILIO_PHONE_NUMBER') ?? '';

  if (!accountSid || !authToken || !fromPhone) {
    console.error('[twilio-sender] Missing Twilio credentials');
    return null;
  }

  // Per-thread rate limit: 1 msg / 3 seconds
  const last = lastSendTime.get(threadId) ?? 0;
  const elapsed = Date.now() - last;
  if (elapsed < 3000) {
    await new Promise((r) => setTimeout(r, 3000 - elapsed));
  }

  // Build recipient list (comma-separated for group MMS)
  const to = recipientPhones.join(',');

  const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const auth = btoa(`${accountSid}:${authToken}`);

  const attempt = async (): Promise<{ sid: string | null; error: boolean }> => {
    try {
      const params = new URLSearchParams({
        From: fromPhone,
        To: to,
        Body: body,
      });

      const res = await fetch(twilioUrl, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });

      lastSendTime.set(threadId, Date.now());

      if (res.ok) {
        const data = await res.json();
        return { sid: data.sid, error: false };
      }

      const errBody = await res.text();
      console.error(`[twilio-sender] Send failed (${res.status}):`, errBody.slice(0, 200));
      return { sid: null, error: true };
    } catch (err) {
      console.error('[twilio-sender] Network error:', err);
      return { sid: null, error: true };
    }
  };

  // First attempt
  let result = await attempt();

  // Retry once with 5-sec backoff
  if (result.error) {
    await new Promise((r) => setTimeout(r, 5000));
    result = await attempt();
  }

  // Track delivery failures for zombie detection
  if (result.error) {
    await trackDeliveryFailure(admin, sessionId);
  } else {
    // Reset consecutive failures on success
    await admin
      .from('trip_sessions')
      .update({ consecutive_failures: 0 })
      .eq('id', sessionId);
  }

  // Log outbound message
  await admin.from('thread_messages').insert({
    thread_id: threadId,
    trip_session_id: sessionId,
    direction: 'outbound',
    sender_role: 'rally',
    body,
    message_sid: result.sid,
  });

  return result.sid;
}

/**
 * Track a delivery failure. If 3+ failures within 48h, mark session ABANDONED.
 */
async function trackDeliveryFailure(
  admin: SupabaseClient,
  sessionId: string,
): Promise<void> {
  const now = new Date();
  const fortyEightHoursAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);

  const { data: session } = await admin
    .from('trip_sessions')
    .select('consecutive_failures, last_failure_at')
    .eq('id', sessionId)
    .single();

  if (!session) return;

  const lastFailure = session.last_failure_at ? new Date(session.last_failure_at) : null;
  const withinWindow = lastFailure && lastFailure > fortyEightHoursAgo;

  const newCount = withinWindow ? (session.consecutive_failures ?? 0) + 1 : 1;

  await admin
    .from('trip_sessions')
    .update({
      consecutive_failures: newCount,
      last_failure_at: now.toISOString(),
    })
    .eq('id', sessionId);

  if (newCount >= 3) {
    console.warn(`[twilio-sender] 3+ failures for session ${sessionId} — marking ABANDONED`);
    await admin
      .from('trip_sessions')
      .update({ status: 'ABANDONED' })
      .eq('id', sessionId);

    // Cancel pending scheduled actions
    await admin
      .from('scheduled_actions')
      .update({ executed_at: now.toISOString() })
      .eq('trip_session_id', sessionId)
      .is('executed_at', null);

    // Cancel pending outbound queue
    await admin
      .from('outbound_message_queue')
      .update({ sent_at: now.toISOString() })
      .eq('trip_session_id', sessionId)
      .is('sent_at', null);
  }
}

/**
 * Process the outbound message queue.
 * Called by the nudge scheduler or a dedicated cron.
 * Dequeues messages in priority order, sends at 1/sec globally.
 */
export async function processOutboundQueue(
  admin: SupabaseClient,
  limit = 20,
): Promise<number> {
  const { data: pending } = await admin
    .from('outbound_message_queue')
    .select('*, trip_sessions!inner(thread_id, status)')
    .is('sent_at', null)
    .lte('send_at', new Date().toISOString())
    .order('priority')
    .order('send_at')
    .limit(limit);

  if (!pending || pending.length === 0) return 0;

  let sent = 0;

  for (const msg of pending) {
    // Skip if session is no longer active
    const sessionData = msg.trip_sessions as { thread_id: string; status: string };
    if (!['ACTIVE', 'FIRST_BOOKING_REACHED'].includes(sessionData.status)) {
      await admin
        .from('outbound_message_queue')
        .update({ sent_at: new Date().toISOString() })
        .eq('id', msg.id);
      continue;
    }

    if (msg.job_type === 'batch' && msg.messages) {
      // Batch job — send sequence with 2-sec gaps
      const messages = msg.messages as Array<{ body: string; delay_ms?: number }>;
      for (const m of messages) {
        // Get participant phones for the thread
        const { data: participants } = await admin
          .from('trip_session_participants')
          .select('phone')
          .eq('trip_session_id', msg.trip_session_id)
          .eq('status', 'active');
        const phones = (participants ?? []).map((p) => p.phone);
        if (phones.length > 0) {
          await sendSms(admin, msg.trip_session_id, msg.thread_id, phones, m.body);
        }
        if (m.delay_ms) await new Promise((r) => setTimeout(r, m.delay_ms));
        else await new Promise((r) => setTimeout(r, 2000));
      }
    } else if (msg.body) {
      // Single message
      const { data: participants } = await admin
        .from('trip_session_participants')
        .select('phone')
        .eq('trip_session_id', msg.trip_session_id)
        .eq('status', 'active');
      const phones = (participants ?? []).map((p) => p.phone);
      if (phones.length > 0) {
        await sendSms(admin, msg.trip_session_id, msg.thread_id, phones, msg.body);
      }
    }

    await admin
      .from('outbound_message_queue')
      .update({ sent_at: new Date().toISOString() })
      .eq('id', msg.id);
    sent++;

    // Global rate limit: 1 msg/sec
    await new Promise((r) => setTimeout(r, 1000));
  }

  return sent;
}
