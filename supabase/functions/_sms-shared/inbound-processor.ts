/**
 * Core inbound message processing — Phase 5.6 of the 1:1 SMS pivot.
 *
 * Rally no longer holds open conversations with individual phones. Inbound
 * SMS is reduced to a few narrowly-scoped paths:
 *   1. Idempotency check + phone normalization
 *   2. Claim-OTP echo silencer (drop 6-digit echoes from claim flow)
 *   3. APP keyword reply (install link)
 *   4. STOP / REJOIN (carrier compliance — opt-out / re-opt-in)
 *
 * Anything else gets a soft redirect to the survey funnel. The phase
 * machine, conversation parser, planner-keyword commands, and the
 * legacy join-link YES/NO handshake are all retired.
 */

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { normalizePhone } from './phone.ts';
import { findOrCreateUser } from './phone-user-linker.ts';
import { track } from './telemetry.ts';
import {
  appKeywordReply,
  isAppKeyword,
} from './templates.ts';
import { sendDm } from './dm-sender.ts';
import {
  resolveInboundMatches,
  buildRedirectBody,
} from './planner-notify.ts';

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

  // ─── Default: soft redirect, no planner relay ────────────────────────────
  // Rally doesn't run conversational SMS, and (Phase 15) it no longer relays
  // member-to-planner messages either. Anything not handled above gets a
  // friendly nudge: "I can't pass this along — text the planner directly."
  //
  // If the sender matches an active trip session participant we still tag
  // the inbound row with `trip_session_id` (for support diagnostics +
  // threading) and bump `last_activity_at` (drives the "responded Xh ago"
  // copy on the participant row). We do NOT flag the row for planner
  // attention or push-notify — those surfaces are gone.
  const matches = await resolveInboundMatches(admin, senderPhone);
  const primaryMatch = matches[0] ?? null;

  // Insert one inbound row per matching session (de-duped by message_sid +
  // trip_session_id pair). When no sessions match, fall back to the legacy
  // session-less row so we still log the message for support diagnosis.
  if (matches.length === 0) {
    await admin.from('thread_messages').insert({
      thread_id: oneToOneThreadId,
      trip_session_id: null,
      direction: 'inbound',
      sender_phone: senderPhone,
      sender_role: 'participant',
      body: trimmedBody,
      message_sid: msg.MessageSid,
    });
  } else {
    for (let i = 0; i < matches.length; i++) {
      const m = matches[i];
      await admin.from('thread_messages').insert({
        thread_id: oneToOneThreadId,
        trip_session_id: m.trip_session_id,
        direction: 'inbound',
        sender_phone: senderPhone,
        sender_role: 'participant',
        body: trimmedBody,
        // message_sid is UNIQUE — only the first row carries it; the rest
        // get null so the index stays clean across multi-session fan-out.
        message_sid: i === 0 ? msg.MessageSid : null,
      });

      // Touch participant.last_activity_at for the dashboard "responded Xh ago" copy.
      try {
        await admin
          .from('trip_session_participants')
          .update({ last_activity_at: new Date().toISOString() })
          .eq('id', m.participant_id);
      } catch {
        /* non-fatal — activity touch is best-effort */
      }
    }
  }

  // Pull the primary match's trip share_token so the redirect SMS can re-share
  // the survey link. Best-effort: any failure falls back to the link-less body.
  let primarySurveyUrl: string | null = null;
  if (primaryMatch?.trip_id) {
    const { data: trip } = await admin
      .from('trips')
      .select('share_token')
      .eq('id', primaryMatch.trip_id)
      .maybeSingle();
    if (trip?.share_token) {
      const base = (Deno.env.get('PUBLIC_SURVEY_BASE_URL') ?? 'https://rallysurveys.netlify.app').replace(/\/+$/, '');
      primarySurveyUrl = `${base}/respond/${trip.share_token}`;
    }
  }

  const redirectReply = buildRedirectBody(matches, primarySurveyUrl);
  await admin.from('thread_messages').insert({
    thread_id: oneToOneThreadId,
    trip_session_id: primaryMatch?.trip_session_id ?? null,
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
    matchedSessions: matches.length,
  }).catch(() => {});
  return { response: redirectReply, sessionId: primaryMatch?.trip_session_id ?? null, phase: null };
}
