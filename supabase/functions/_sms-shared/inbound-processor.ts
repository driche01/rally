/**
 * Core inbound message processing — Phase 5.6 of the 1:1 SMS pivot.
 *
 * Rally no longer holds open conversations with individual phones. Inbound
 * SMS is reduced to four narrowly-scoped paths:
 *   1. Idempotency check + phone normalization
 *   2. Claim-OTP echo silencer (drop 6-digit echoes from claim flow)
 *   3. Join-link YES/NO confirmation (Phase 1 — promote pending submissions)
 *   4. APP keyword reply (install link)
 *   5. STOP / REJOIN (carrier compliance — opt-out / re-opt-in)
 *
 * Anything else gets a soft redirect to the survey/join link funnel. The
 * phase machine, conversation parser, planner-keyword commands, and
 * new-planner kickoff are all bypassed.
 */

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { normalizePhone } from './phone.ts';
import { findOrCreateUser } from './phone-user-linker.ts';
import { track } from './telemetry.ts';
import {
  appKeywordReply,
  isAppKeyword,
  joinKickoffSms,
} from './templates.ts';
import { matchJoinConfirmIntent } from './join-intent.ts';
import { sendDm } from './dm-sender.ts';

function getAppDownloadUrl(): string | null {
  try {
    return Deno.env.get('APP_DOWNLOAD_URL') ?? null;
  } catch {
    return null;
  }
}

export interface ParsedTwilioMessage {
  MessageSid: string;
  From: string;
  To: string;
  Body: string;
  NumMedia: string;
  FriendlyName?: string;
  MediaUrl0?: string;
  MediaContentType0?: string;
}

export interface ProcessResult {
  response: string | null;
  sessionId: string | null;
  phase: string | null;
}

export async function processInboundMessage(
  admin: SupabaseClient,
  msg: ParsedTwilioMessage,
  _allRallyPhones: string[],
): Promise<ProcessResult> {
  // ─── Idempotency check ──────────────────────────────────────────────────
  const { data: existing } = await admin
    .from('thread_messages')
    .select('id')
    .eq('message_sid', msg.MessageSid)
    .maybeSingle();
  if (existing) {
    return { response: null, sessionId: null, phase: null };
  }

  // ─── Normalize sender phone ─────────────────────────────────────────────
  const senderPhone = normalizePhone(msg.From);
  if (!senderPhone) {
    return { response: null, sessionId: null, phase: null };
  }

  const oneToOneThreadId = `1to1_${senderPhone}`;
  const trimmedBody = msg.Body.trim();

  // ─── Resolve user ───────────────────────────────────────────────────────
  const user = await findOrCreateUser(admin, senderPhone);

  // ─── Claim-OTP echo short-circuit ───────────────────────────────────────
  if (/^\d{6}$/.test(trimmedBody)) {
    const { data: hasClaim } = await admin.rpc('has_active_claim_token', {
      p_phone: senderPhone,
    });
    if (hasClaim === true) {
      return { response: null, sessionId: null, phase: null };
    }
  }

  // ─── Join-link YES/NO confirmation ──────────────────────────────────────
  const intent = matchJoinConfirmIntent(trimmedBody);
  if (intent) {
    const { data: confirmResult } = await admin.rpc('confirm_join_submission', {
      p_phone: senderPhone,
      p_decision: intent,
    });
    const cr = confirmResult as
      | { ok: true; reason: 'confirmed'; trip_session_id: string; user_id: string;
          display_name: string; planner_name: string | null; destination: string | null }
      | { ok: true; reason: 'declined' }
      | { ok: false; reason: string }
      | null;

    if (cr?.ok && cr.reason === 'confirmed') {
      await admin.from('thread_messages').insert({
        thread_id: oneToOneThreadId,
        trip_session_id: cr.trip_session_id,
        direction: 'inbound',
        sender_phone: senderPhone,
        sender_role: 'participant',
        body: trimmedBody,
        message_sid: msg.MessageSid,
      });

      const kickoffBody = joinKickoffSms({
        plannerName: cr.planner_name,
        destination: cr.destination,
      });
      await sendDm(admin, senderPhone, kickoffBody, {
        tripSessionId: cr.trip_session_id,
        idempotencyKey: `join_kickoff_${cr.trip_session_id}_${senderPhone}`,
      });

      track('join_link_confirmed', {
        distinct_id: cr.trip_session_id,
        tripSessionId: cr.trip_session_id,
        userId: cr.user_id,
        trip_model: '1to1',
      }).catch(() => {});

      return { response: null, sessionId: cr.trip_session_id, phase: 'INTRO' };
    }

    if (cr?.ok && cr.reason === 'declined') {
      await admin.from('thread_messages').insert({
        thread_id: oneToOneThreadId,
        trip_session_id: null,
        direction: 'inbound',
        sender_phone: senderPhone,
        sender_role: 'participant',
        body: trimmedBody,
        message_sid: msg.MessageSid,
      });
      const declineReply = "No problem — you won't hear from me about this trip.";
      await admin.from('thread_messages').insert({
        thread_id: oneToOneThreadId,
        trip_session_id: null,
        direction: 'outbound',
        sender_phone: null,
        sender_role: 'rally',
        body: declineReply,
        message_sid: null,
      });
      track('join_link_declined', {
        distinct_id: senderPhone,
        trip_model: '1to1',
      }).catch(() => {});
      return { response: declineReply, sessionId: null, phase: null };
    }
    // No pending submission — fall through to keyword/redirect handling.
  }

  // ─── APP keyword ────────────────────────────────────────────────────────
  if (isAppKeyword(trimmedBody)) {
    const kwResponse = appKeywordReply({ appDownloadUrl: getAppDownloadUrl() });
    if (kwResponse) {
      await admin.from('thread_messages').insert({
        thread_id: oneToOneThreadId,
        trip_session_id: null,
        direction: 'inbound',
        sender_phone: senderPhone,
        sender_role: 'participant',
        body: trimmedBody,
        message_sid: msg.MessageSid,
      });
      await admin.from('thread_messages').insert({
        thread_id: oneToOneThreadId,
        trip_session_id: null,
        direction: 'outbound',
        sender_phone: null,
        sender_role: 'rally',
        body: kwResponse,
        message_sid: null,
      });
      return { response: kwResponse, sessionId: null, phase: null };
    }
  }

  // ─── STOP / REJOIN (carrier compliance, session-less) ───────────────────
  const upper = trimmedBody.toUpperCase();
  if (upper === 'STOP' || upper === 'UNSUBSCRIBE' || upper === 'STOP ALL') {
    await admin.from('thread_messages').insert({
      thread_id: oneToOneThreadId,
      trip_session_id: null,
      direction: 'inbound',
      sender_phone: senderPhone,
      sender_role: 'participant',
      body: trimmedBody,
      message_sid: msg.MessageSid,
    });
    await admin.from('users').update({ opted_out: true }).eq('id', user.id);
    await admin
      .from('trip_session_participants')
      .update({ status: 'opted_out' })
      .eq('user_id', user.id)
      .eq('status', 'active');
    const stopReply = "You're opted out. Reply REJOIN to start receiving texts again.";
    await admin.from('thread_messages').insert({
      thread_id: oneToOneThreadId,
      trip_session_id: null,
      direction: 'outbound',
      sender_phone: null,
      sender_role: 'rally',
      body: stopReply,
      message_sid: null,
    });
    track('sms_opt_out', {
      distinct_id: senderPhone,
      userId: user.id,
      via: 'stop_keyword_global',
    }).catch(() => {});
    return { response: stopReply, sessionId: null, phase: null };
  }
  if (upper === 'REJOIN' || upper === 'START' || upper === 'UNSTOP') {
    await admin.from('thread_messages').insert({
      thread_id: oneToOneThreadId,
      trip_session_id: null,
      direction: 'inbound',
      sender_phone: senderPhone,
      sender_role: 'participant',
      body: trimmedBody,
      message_sid: msg.MessageSid,
    });
    await admin.from('users').update({ opted_out: false }).eq('id', user.id);
    await admin
      .from('trip_session_participants')
      .update({ status: 'active' })
      .eq('user_id', user.id)
      .eq('status', 'opted_out');
    const rejoinReply = "Welcome back. You'll start receiving Rally texts again.";
    await admin.from('thread_messages').insert({
      thread_id: oneToOneThreadId,
      trip_session_id: null,
      direction: 'outbound',
      sender_phone: null,
      sender_role: 'rally',
      body: rejoinReply,
      message_sid: null,
    });
    return { response: rejoinReply, sessionId: null, phase: null };
  }

  // ─── Default: soft redirect ─────────────────────────────────────────────
  // Rally doesn't run conversational SMS anymore. Anything that wasn't
  // handled above (planning intent, name extraction, free-form replies,
  // legacy keyword commands) gets a friendly nudge back to the link funnel.
  await admin.from('thread_messages').insert({
    thread_id: oneToOneThreadId,
    trip_session_id: null,
    direction: 'inbound',
    sender_phone: senderPhone,
    sender_role: 'participant',
    body: trimmedBody,
    message_sid: msg.MessageSid,
  });
  const redirectReply =
    "I'm Rally — I help groups plan trips. " +
    "If a friend invited you, tap their link to join. " +
    "To start a trip, sign up at rallysurveys.netlify.app and share your link with friends. " +
    "Reply STOP to opt out.";
  await admin.from('thread_messages').insert({
    thread_id: oneToOneThreadId,
    trip_session_id: null,
    direction: 'outbound',
    sender_phone: null,
    sender_role: 'rally',
    body: redirectReply,
    message_sid: null,
  });
  track('sms_redirect_sent', {
    distinct_id: senderPhone,
    userId: user.id,
    bodyLength: trimmedBody.length,
  }).catch(() => {});
  return { response: redirectReply, sessionId: null, phase: null };
}
