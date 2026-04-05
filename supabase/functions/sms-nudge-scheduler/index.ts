/**
 * Supabase Edge Function — sms-nudge-scheduler
 *
 * Component 7: NudgeScheduler
 *
 * Runs on a cron schedule. Handles 5 jobs:
 *   1. Poll reminders (24h + 48h nudges)
 *   2. Momentum check (7-day idle sessions)
 *   3. Flight price monitoring (weekly, Mondays)
 *   4. Deadline reminders (3 days, 1 day, day-of)
 *   5. Pre-trip payment reminder (14 days before trip)
 *
 * Also processes scheduled_actions (hype cooldown timers).
 *
 * Deploy: supabase functions deploy sms-nudge-scheduler
 * Invoke via pg_cron hourly:
 *   SELECT cron.schedule('sms-nudge-hourly', '0 * * * *',
 *     $$SELECT net.http_post(url, ...) $$);
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const admin = createClient(supabaseUrl, serviceRoleKey);

  const now = new Date();
  const results = {
    pollNudges: 0,
    momentumChecks: 0,
    deadlineReminders: 0,
    paymentReminders: 0,
    reEngagements: 0,
    scheduledActions: 0,
    outboundSent: 0,
    errors: 0,
  };

  try {
    // ─── Job 1: Poll reminders ─────────────────────────────────────────
    await runPollReminders(admin, now, results);

    // ─── Job 2: Momentum check ─────────────────────────────────────────
    await runMomentumChecks(admin, now, results);

    // ─── Job 4: Deadline reminders ─────────────────────────────────────
    await runDeadlineReminders(admin, now, results);

    // ─── Job 5: Pre-trip payment reminders ─────────────────────────────
    await runPaymentReminders(admin, now, results);

    // ─── Job 7: Post-trip re-engagement ────────────────────────────────
    await runReEngagementJob(admin, results);

    // ─── Process scheduled_actions ─────────────────────────────────────
    await processScheduledActions(admin, now, results);

    // ─── Process outbound message queue ────────────────────────────────
    results.outboundSent = await processOutboundQueueJob(admin);

    console.log('[sms-nudge] Results:', JSON.stringify(results));

    return new Response(JSON.stringify(results), {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[sms-nudge] Fatal error:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
});

// ─── Job 1: Poll reminders ───────────────────────────────────────────────────

async function runPollReminders(
  admin: ReturnType<typeof createClient>,
  now: Date,
  results: Record<string, number>,
) {
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const fortyEightHoursAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString();

  // Find open polls older than 24h that haven't been nudged
  const { data: polls24h } = await admin
    .from('polls')
    .select('id, trip_session_id, trip_id, title, opened_at')
    .in('status', ['live', 'open'])
    .is('nudge_24h_sent_at', null)
    .lt('opened_at', twentyFourHoursAgo);

  for (const poll of polls24h ?? []) {
    try {
      // Get session (check it's active and not paused)
      const { data: session } = await admin
        .from('trip_sessions')
        .select('id, status, paused, thread_id')
        .eq('id', poll.trip_session_id)
        .eq('status', 'ACTIVE')
        .eq('paused', false)
        .maybeSingle();

      if (!session) continue;

      // Find non-responders
      const { data: participants } = await admin
        .from('trip_session_participants')
        .select('display_name, phone, user_id')
        .eq('trip_session_id', session.id)
        .eq('status', 'active');

      const { data: responses } = await admin
        .from('poll_responses')
        .select('respondent_id')
        .eq('poll_id', poll.id);

      const respondentIds = new Set((responses ?? []).map((r) => r.respondent_id));

      // Get respondent IDs for participants to compare
      const { data: respondents } = await admin
        .from('respondents')
        .select('id, phone')
        .eq('trip_id', poll.trip_id);

      const respondentMap = new Map((respondents ?? []).map((r) => [r.phone, r.id]));

      const nonResponders = (participants ?? []).filter((p) => {
        const rId = respondentMap.get(p.phone);
        return rId && !respondentIds.has(rId);
      });

      if (nonResponders.length > 0) {
        const names = nonResponders.map((p) => p.display_name ?? p.phone).join(', ');
        const nudge = `Still waiting on ${names} \u2014 reply when you can.`;

        await storeOutbound(admin, session, nudge);
        await admin.from('polls').update({ nudge_24h_sent_at: now.toISOString() }).eq('id', poll.id);
        results.pollNudges++;
      }
    } catch (err) {
      console.error(`[sms-nudge] Poll 24h error for ${poll.id}:`, err);
      results.errors++;
    }
  }

  // Find open polls older than 48h — final nudge + close
  const { data: polls48h } = await admin
    .from('polls')
    .select('id, trip_session_id, trip_id, title')
    .in('status', ['live', 'open'])
    .not('nudge_24h_sent_at', 'is', null)
    .is('nudge_48h_sent_at', null)
    .lt('opened_at', fortyEightHoursAgo);

  for (const poll of polls48h ?? []) {
    try {
      const { data: session } = await admin
        .from('trip_sessions')
        .select('id, status, paused')
        .eq('id', poll.trip_session_id)
        .eq('status', 'ACTIVE')
        .eq('paused', false)
        .maybeSingle();

      if (!session) continue;

      // Mark non-responders and close the poll
      await admin
        .from('polls')
        .update({
          nudge_48h_sent_at: now.toISOString(),
          status: 'decided',
          closed_at: now.toISOString(),
        })
        .eq('id', poll.id);

      // Resolve with available votes
      const { data: options } = await admin
        .from('poll_options')
        .select('id, label')
        .eq('poll_id', poll.id)
        .order('position');

      const { data: responses } = await admin
        .from('poll_responses')
        .select('option_id')
        .eq('poll_id', poll.id);

      if (options && responses && responses.length > 0) {
        const counts = new Map<string, number>();
        for (const r of responses) {
          counts.set(r.option_id, (counts.get(r.option_id) ?? 0) + 1);
        }
        let maxCount = 0;
        let winnerId = '';
        for (const [id, count] of counts) {
          if (count > maxCount) { maxCount = count; winnerId = id; }
        }
        const winner = options.find((o) => o.id === winnerId)?.label ?? null;
        if (winner) {
          await admin.from('polls').update({ winner, decided_option_id: winnerId }).eq('id', poll.id);
        }
      }

      await admin
        .from('trip_sessions')
        .update({ current_poll_id: null, updated_at: now.toISOString() })
        .eq('id', session.id);

      results.pollNudges++;
    } catch (err) {
      console.error(`[sms-nudge] Poll 48h error for ${poll.id}:`, err);
      results.errors++;
    }
  }
}

// ─── Job 2: Momentum check ──────────────────────────────────────────────────

async function runMomentumChecks(
  admin: ReturnType<typeof createClient>,
  now: Date,
  results: Record<string, number>,
) {
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: staleSessions } = await admin
    .from('trip_sessions')
    .select('id, thread_id, destination, momentum_check_sent_at')
    .eq('status', 'ACTIVE')
    .eq('paused', false)
    .is('phase_sub_state', null)
    .is('current_poll_id', null)
    .lt('last_message_at', sevenDaysAgo);

  for (const session of staleSessions ?? []) {
    // Don't repeat within same 7-day window
    if (session.momentum_check_sent_at) {
      const lastCheck = new Date(session.momentum_check_sent_at);
      if (now.getTime() - lastCheck.getTime() < 7 * 24 * 60 * 60 * 1000) continue;
    }

    const dest = session.destination ?? 'the trip';
    const msg = `Quick check-in \u2014 ${dest} still on? Just making sure the dream is alive \u{1F30A}`;

    await storeOutbound(admin, session, msg);
    await admin
      .from('trip_sessions')
      .update({ momentum_check_sent_at: now.toISOString() })
      .eq('id', session.id);
    results.momentumChecks++;
  }
}

// ─── Job 4: Deadline reminders ───────────────────────────────────────────────

async function runDeadlineReminders(
  admin: ReturnType<typeof createClient>,
  now: Date,
  results: Record<string, number>,
) {
  const { data: sessions } = await admin
    .from('trip_sessions')
    .select('id, thread_id, deadlines')
    .eq('status', 'ACTIVE')
    .not('deadlines', 'eq', '[]');

  for (const session of sessions ?? []) {
    const deadlines = session.deadlines as Array<{
      item: string;
      date: string;
      reminders_sent?: string[];
    }>;
    if (!deadlines || deadlines.length === 0) continue;

    const today = now.toISOString().split('T')[0];

    for (const dl of deadlines) {
      const dlDate = new Date(dl.date);
      const daysUntil = Math.round((dlDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
      const sent = dl.reminders_sent ?? [];

      let msg: string | null = null;
      let reminderKey: string | null = null;

      if (daysUntil === 3 && !sent.includes('3day')) {
        msg = `Reminder \u2014 deadline for ${dl.item} in 3 days (${dl.date}). Get it sorted!`;
        reminderKey = '3day';
      } else if (daysUntil === 1 && !sent.includes('1day')) {
        msg = `Tomorrow is the deadline for ${dl.item} \u2014 ${dl.date}. Don't leave the planner hanging.`;
        reminderKey = '1day';
      } else if (daysUntil === 0 && !sent.includes('today')) {
        msg = `Today's the day \u2014 deadline for ${dl.item}. Last chance to sort it.`;
        reminderKey = 'today';
      }

      if (msg && reminderKey) {
        await storeOutbound(admin, session, msg);
        dl.reminders_sent = [...sent, reminderKey];
        results.deadlineReminders++;
      }
    }

    // Update deadlines with reminders_sent
    await admin
      .from('trip_sessions')
      .update({ deadlines })
      .eq('id', session.id);
  }
}

// ─── Job 5: Pre-trip payment reminders ───────────────────────────────────────

async function runPaymentReminders(
  admin: ReturnType<typeof createClient>,
  now: Date,
  results: Record<string, number>,
) {
  const fourteenDaysFromNow = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split('T')[0];

  // Find sessions with trip starting in ~14 days
  const { data: sessions } = await admin
    .from('trip_sessions')
    .select('id, thread_id, dates, pre_trip_payment_reminder_sent')
    .in('status', ['ACTIVE', 'FIRST_BOOKING_REACHED'])
    .eq('pre_trip_payment_reminder_sent', false);

  for (const session of sessions ?? []) {
    const dates = session.dates as { start?: string } | null;
    if (!dates?.start) continue;

    // Check if trip starts in 14 days (±1 day tolerance)
    const startDate = new Date(dates.start);
    const daysUntil = Math.round((startDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
    if (daysUntil > 15 || daysUntil < 13) continue;

    // Check for pending splits
    const { data: pendingSplits } = await admin
      .from('split_requests')
      .select('payer_user_id, amount')
      .eq('trip_session_id', session.id)
      .eq('status', 'pending');

    if (!pendingSplits || pendingSplits.length === 0) continue;

    // Get payer names
    const payerIds = pendingSplits.map((s) => s.payer_user_id);
    const { data: payers } = await admin
      .from('users')
      .select('id, display_name')
      .in('id', payerIds);

    const payerNames = (payers ?? []).map((p) => p.display_name ?? 'someone');
    const amount = pendingSplits[0].amount;

    const msg =
      `Trip is 2 weeks away \u{1F5D3}\uFE0F \u2014 just a heads up, still waiting on ` +
      `${payerNames.join(' and ')} for the split ($${amount} each).`;

    await storeOutbound(admin, session, msg);
    await admin
      .from('trip_sessions')
      .update({ pre_trip_payment_reminder_sent: true })
      .eq('id', session.id);
    results.paymentReminders++;
  }
}

// ─── Process scheduled_actions ───────────────────────────────────────────────

async function processScheduledActions(
  admin: ReturnType<typeof createClient>,
  now: Date,
  results: Record<string, number>,
) {
  const { data: actions } = await admin
    .from('scheduled_actions')
    .select('*')
    .is('executed_at', null)
    .lte('execute_at', now.toISOString())
    .order('execute_at')
    .limit(50);

  for (const action of actions ?? []) {
    try {
      // Get session state
      const { data: session } = await admin
        .from('trip_sessions')
        .select('id, phase_sub_state, last_message_at, phase')
        .eq('id', action.trip_session_id)
        .maybeSingle();

      if (!session) {
        await markActionDone(admin, action.id, now);
        continue;
      }

      if (action.action_type === 'hype_cooldown_silence') {
        // Check if still celebrating
        if (session.phase_sub_state !== 'CELEBRATING') {
          await markActionDone(admin, action.id, now);
          continue;
        }

        const lastMsg = new Date(session.last_message_at);
        const silenceDuration = now.getTime() - lastMsg.getTime();

        if (silenceDuration >= 90_000) {
          // Group has gone quiet — advance
          await admin
            .from('trip_sessions')
            .update({ phase_sub_state: null, celebration_started_at: null })
            .eq('id', session.id);
          await markActionDone(admin, action.id, now);
        } else {
          // Still active — reschedule
          const remaining = 90_000 - silenceDuration;
          await admin
            .from('scheduled_actions')
            .update({ execute_at: new Date(now.getTime() + remaining).toISOString() })
            .eq('id', action.id);
        }
      } else if (action.action_type === 'hype_cooldown_cap') {
        if (session.phase_sub_state === 'CELEBRATING') {
          await admin
            .from('trip_sessions')
            .update({ phase_sub_state: null, celebration_started_at: null })
            .eq('id', session.id);
        }
        await markActionDone(admin, action.id, now);
      } else {
        // Unknown action type — mark done
        await markActionDone(admin, action.id, now);
      }

      results.scheduledActions++;
    } catch (err) {
      console.error(`[sms-nudge] Action error for ${action.id}:`, err);
      results.errors++;
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function storeOutbound(
  admin: ReturnType<typeof createClient>,
  session: { id: string; thread_id: string },
  body: string,
) {
  // Store in thread_messages
  await admin.from('thread_messages').insert({
    thread_id: session.thread_id,
    trip_session_id: session.id,
    direction: 'outbound',
    sender_role: 'rally',
    body,
  });

  // Queue in outbound_message_queue for rate-limited sending
  await admin.from('outbound_message_queue').insert({
    trip_session_id: session.id,
    thread_id: session.thread_id,
    priority: 4, // cron-triggered = lowest priority
    body,
  });
}

async function markActionDone(
  admin: ReturnType<typeof createClient>,
  actionId: string,
  now: Date,
) {
  await admin
    .from('scheduled_actions')
    .update({ executed_at: now.toISOString() })
    .eq('id', actionId);
}

// ─── Job 7: Post-trip re-engagement ──────────────────────────────────────────

async function runReEngagementJob(
  admin: ReturnType<typeof createClient>,
  results: Record<string, number>,
) {
  const now = new Date();
  const fortyTwoDaysAgo = new Date(now.getTime() - 42 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const fiftySixDaysAgo = new Date(now.getTime() - 56 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const { data: sessions } = await admin
    .from('trip_sessions')
    .select('id, thread_id, destination, dates, re_engagement_sent')
    .in('status', ['FIRST_BOOKING_REACHED', 'COMPLETE'])
    .eq('re_engagement_sent', false);

  for (const session of sessions ?? []) {
    const dates = session.dates as { end?: string } | null;
    if (!dates?.end) continue;

    if (dates.end > fortyTwoDaysAgo || dates.end < fiftySixDaysAgo) continue;

    const weeksAgo = Math.round(
      (now.getTime() - new Date(dates.end).getTime()) / (7 * 24 * 60 * 60 * 1000),
    );
    const dest = session.destination ?? 'that trip';

    const msg =
      `Your ${dest} trip was ${weeksAgo} weeks ago \u2014 already time to plan the next one? ` +
      `Reply YES and I'll get the group going.`;

    await storeOutbound(admin, session, msg);

    await admin
      .from('trip_sessions')
      .update({
        re_engagement_sent: true,
        re_engagement_sent_at: now.toISOString(),
        status: 'RE_ENGAGEMENT_PENDING',
      })
      .eq('id', session.id);

    results.reEngagements++;
  }
}

// ─── Outbound queue processor ────────────────────────────────────────────────

async function processOutboundQueueJob(
  admin: ReturnType<typeof createClient>,
): Promise<number> {
  const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID') ?? '';
  const authToken = Deno.env.get('TWILIO_AUTH_TOKEN') ?? '';
  const fromPhone = Deno.env.get('TWILIO_PHONE_NUMBER') ?? '';

  if (!accountSid || !authToken || !fromPhone) {
    console.error('[outbound-queue] Missing Twilio credentials');
    return 0;
  }

  const now = new Date();

  // Get pending messages ordered by priority then time
  const { data: pending } = await admin
    .from('outbound_message_queue')
    .select('id, trip_session_id, thread_id, priority, job_type, body, messages')
    .is('sent_at', null)
    .lte('send_at', now.toISOString())
    .order('priority')
    .order('send_at')
    .limit(20);

  if (!pending || pending.length === 0) return 0;

  const auth = btoa(`${accountSid}:${authToken}`);
  const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  let sent = 0;

  for (const msg of pending) {
    // Get participant phones for the thread
    const { data: participants } = await admin
      .from('trip_session_participants')
      .select('phone')
      .eq('trip_session_id', msg.trip_session_id)
      .eq('status', 'active');

    const phones = (participants ?? []).map((p: { phone: string }) => p.phone);
    if (phones.length === 0) {
      await admin.from('outbound_message_queue').update({ sent_at: now.toISOString() }).eq('id', msg.id);
      continue;
    }

    const messageBodies: string[] = [];
    if (msg.job_type === 'batch' && msg.messages) {
      const batch = (typeof msg.messages === 'string' ? JSON.parse(msg.messages) : msg.messages) as Array<{ body: string }>;
      for (const m of batch) messageBodies.push(m.body);
    } else if (msg.body) {
      messageBodies.push(msg.body);
    }

    for (const body of messageBodies) {
      try {
        const params = new URLSearchParams({
          From: fromPhone,
          To: phones.join(','),
          Body: body,
        });

        await fetch(twilioUrl, {
          method: 'POST',
          headers: {
            Authorization: `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: params.toString(),
        });

        sent++;
      } catch (err) {
        console.error(`[outbound-queue] Send error:`, err);
      }

      // Rate limit: 1 msg/sec globally
      await new Promise((r) => setTimeout(r, 1000));
    }

    await admin.from('outbound_message_queue').update({ sent_at: now.toISOString() }).eq('id', msg.id);
  }

  return sent;
}
