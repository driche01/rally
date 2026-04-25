/**
 * Core inbound message processing logic, extracted from sms-inbound/index.ts
 * for testability. The HTTP handler in index.ts is a thin wrapper that parses
 * the request, validates the Twilio signature, and calls this function.
 *
 * Phase 2 of the 1:1 pivot: every inbound is treated as 1:1. The legacy
 * comma-parsed `To:` group routing is gone, along with the app_pending_<tripId>
 * activation flow. Sender phone → active trip session via
 * findActiveSessionForPhone(); a sender with no active session falls into
 * handleNewPlannerInbound() which can mint a fresh session + join link in one
 * round-trip when the body shows planning intent.
 */

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { normalizePhone } from './phone.ts';
import { findOrCreateUser, ensureRespondent } from './phone-user-linker.ts';
import type { SmsUser } from './phone-user-linker.ts';
import {
  findActiveSessionForPhone,
  createPlannerSessionWithJoinLink,
  touchSession,
} from './trip-session.ts';
import type { TripSession, TripSessionParticipant } from './trip-session.ts';
import { routeMessage } from './message-router.ts';
import type { RoutedMessage } from './message-router.ts';
import { track } from './telemetry.ts';
import {
  plannerWelcomeOneToOne,
  appKeywordReply,
  isAppKeyword,
  joinKickoffSms,
  plannerKickoffWithLink,
  noActiveSessionFallback,
} from './templates.ts';
import { matchJoinConfirmIntent } from './join-intent.ts';
import { sendDm } from './dm-sender.ts';

// Read lazily so tests / alternate deployments can set this dynamically.
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
  // A 6-digit code from a phone with a live phone_claim_tokens row is the OTP
  // being echoed back instead of typed into the app. Drop silently — don't
  // let destination parsers eat it.
  if (/^\d{6}$/.test(trimmedBody)) {
    const { data: hasClaim } = await admin.rpc('has_active_claim_token', {
      p_phone: senderPhone,
    });
    if (hasClaim === true) {
      return { response: null, sessionId: null, phase: null };
    }
  }

  // ─── Join-link confirmation short-circuit (Phase 1 of 1:1 pivot) ───────
  // YES/NO from a phone with a pending join_link_submission promotes them
  // to active participant. Falls through to normal routing if no pending
  // submission exists (the RPC returns no_pending and we ignore it).
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
    // no_pending / expired / etc. — fall through.
  }

  // ─── APP keyword short-circuit ──────────────────────────────────────────
  // Always available regardless of session state.
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

  // ─── Handle non-text MMS ────────────────────────────────────────────────
  let body = msg.Body.trim();
  const hasMedia = parseInt(msg.NumMedia) > 0;
  const bookingPatterns = [
    'google.com/flights', 'airbnb.com', 'vrbo.com',
    'delta.com', 'united.com', 'southwest.com', 'jetblue.com',
    'booking.com', 'expedia.com',
  ];
  if (hasMedia && !body) {
    const mediaUrl = msg.MediaUrl0 ?? '';
    const isBooking = bookingPatterns.some((p) => mediaUrl.includes(p));
    if (isBooking) {
      body = 'YES';
    } else {
      const contentType = msg.MediaContentType0 ?? '';
      body = contentType.startsWith('audio/') ? '[voice memo]' : '[image]';
    }
  }

  // ─── Find existing active session for this phone ────────────────────────
  let session: TripSession | null = null;
  let participant: TripSessionParticipant | null = null;
  let priorLastMessageAt: string | null = null;
  let kickoffResponse: string | null = null;

  const found = await findActiveSessionForPhone(admin, senderPhone);
  if (found) {
    session = found.session;
    participant = found.participant;
    priorLastMessageAt = session.last_message_at ?? null;
    await touchSession(admin, session.id);
  } else {
    // ─── New planner inbound ──────────────────────────────────────────────
    const result = await handleNewPlannerInbound(admin, user, body, msg.FriendlyName ?? null);
    session = result.session;
    participant = result.participant;
    kickoffResponse = result.response;
    if (session) {
      priorLastMessageAt = session.last_message_at ?? null;
    }
  }

  // ─── Store inbound message ──────────────────────────────────────────────
  await admin.from('thread_messages').insert({
    thread_id: oneToOneThreadId,
    trip_session_id: session?.id ?? null,
    direction: 'inbound',
    sender_phone: senderPhone,
    sender_role: participant?.is_planner ? 'planner' : 'participant',
    body,
    message_sid: msg.MessageSid,
    media_url: msg.MediaUrl0 ?? null,
  });

  // ─── Route the message (or use the kickoff response) ────────────────────
  let response: string | null = null;
  if (kickoffResponse) {
    response = kickoffResponse;
  } else if (session) {
    const routed: RoutedMessage = {
      type: 'phase',
      body,
      fromUser: user,
      session,
      participant,
    };
    response = await routeMessage(admin, routed);
  }

  // ─── Welcome-back recap ─────────────────────────────────────────────────
  // If the session was idle >7 days and we haven't already sent a recap for
  // this gap, prepend a short recap. Only fires when we're actually replying.
  if (response && session && priorLastMessageAt) {
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
    const idleMs = Date.now() - new Date(priorLastMessageAt).getTime();
    const dormantPhases = ['COMPLETE', 'CANCELLED', 'ABANDONED'];
    const recapEligible =
      idleMs >= SEVEN_DAYS_MS &&
      !dormantPhases.includes(session.phase) &&
      session.status !== 'RE_ENGAGEMENT_PENDING';
    if (recapEligible) {
      const wbSentAt = (session as { welcome_back_sent_at?: string | null }).welcome_back_sent_at;
      const alreadySent = wbSentAt && new Date(wbSentAt).getTime() > new Date(priorLastMessageAt).getTime();
      if (!alreadySent) {
        const recap = buildWelcomeBackRecap(session);
        response = `${recap}\n\n${response}`;
        await admin.from('trip_sessions')
          .update({ welcome_back_sent_at: new Date().toISOString() })
          .eq('id', session.id);
      }
    }
  }

  // ─── Store outbound message ─────────────────────────────────────────────
  if (response) {
    await admin.from('thread_messages').insert({
      thread_id: oneToOneThreadId,
      trip_session_id: session?.id ?? null,
      direction: 'outbound',
      sender_phone: null,
      sender_role: 'rally',
      body: response,
      message_sid: null,
    });
  }

  // ─── Return current phase ───────────────────────────────────────────────
  let currentPhase: string | null = null;
  if (session?.id) {
    const { data: freshSession } = await admin
      .from('trip_sessions')
      .select('phase')
      .eq('id', session.id)
      .maybeSingle();
    currentPhase = freshSession?.phase ?? session.phase;
  }

  return {
    response,
    sessionId: session?.id ?? null,
    phase: currentPhase,
  };
}

// ─── New-planner handling ───────────────────────────────────────────────────

interface NewPlannerOutcome {
  session: TripSession | null;
  participant: TripSessionParticipant | null;
  /** The response Rally should send back. Null if no reply (idempotent welcome already sent). */
  response: string | null;
}

/**
 * Handle a sender who has no active session. Three cases:
 *   1. Body shows planning intent → mint a session + join link, reply with URL.
 *   2. Body is just a greeting and the user is brand-new → send the welcome
 *      (idempotent — skipped if we've ever replied to this 1:1 thread).
 *   3. Otherwise → soft fallback: "no trip with you yet, reply with a destination".
 */
async function handleNewPlannerInbound(
  admin: SupabaseClient,
  user: SmsUser,
  body: string,
  threadName: string | null,
): Promise<NewPlannerOutcome> {
  const oneToOneThreadId = `1to1_${user.phone}`;

  // ─── Case 1: planning intent → auto-create session + join link ──────────
  const intentHints = detectPlanningIntent(body);
  if (intentHints) {
    const { session, participant, joinUrl } = await createPlannerSessionWithJoinLink(
      admin,
      user,
      {
        destination: intentHints.destination,
        dates: intentHints.dates,
        budget: intentHints.budget,
        threadName,
      },
    );

    if (intentHints.plannerName) {
      await admin.from('users').update({ display_name: intentHints.plannerName }).eq('id', user.id);
      await admin.from('trip_session_participants')
        .update({ display_name: intentHints.plannerName })
        .eq('trip_session_id', session.id)
        .eq('user_id', user.id);
    }

    if (session.trip_id) {
      await ensureRespondent(admin, session.trip_id, user);
    }

    track('sms_planner_session_created_from_text', {
      distinct_id: session.id,
      sessionId: session.id,
      plannerUserId: user.id,
      hasIntent: true,
      hasDestination: !!intentHints.destination,
      hasDates: !!intentHints.dates,
      hasBudget: !!intentHints.budget,
      trip_model: '1to1',
    }).catch(() => {});

    const reply = plannerKickoffWithLink({ url: joinUrl, destination: intentHints.destination });
    return { session, participant, response: reply };
  }

  // ─── Case 2: brand-new user, greeting → welcome (idempotent) ────────────
  if (!user.returning) {
    const { data: priorOutbound } = await admin
      .from('thread_messages')
      .select('id')
      .eq('thread_id', oneToOneThreadId)
      .eq('direction', 'outbound')
      .limit(1)
      .maybeSingle();
    if (!priorOutbound) {
      return {
        session: null,
        participant: null,
        response: plannerWelcomeOneToOne({
          channel: 'sms',
          appDownloadUrl: getAppDownloadUrl(),
        }),
      };
    }
  }

  // ─── Case 3: soft fallback ──────────────────────────────────────────────
  return {
    session: null,
    participant: null,
    response: noActiveSessionFallback(),
  };
}

// ─── Planning-intent detection ──────────────────────────────────────────────

interface IntentHints {
  plannerName: string | null;
  destination: string | null;
  dates: { start: string; end: string; nights: number } | null;
  budget: number | null;
}

const PLANNING_VERBS = /\b(plan|planning|organize|coordinate|set\s*up|sort)\b/i;
const TRIP_NOUNS = /\b(trip|getaway|vacation|holiday|weekend|adventure)\b/i;
const DESTINATION_PREP = /\bto\s+([A-Z][\p{L}\-' ]{1,40})/u;

/**
 * Light-touch intent detector. Returns hints if the body looks like a planner
 * kicking off a trip; null otherwise. Designed to err toward "no intent" so
 * "hey" doesn't accidentally spawn a trip session.
 *
 * Triggers when ANY of these holds:
 *   - "Name — destination[, dates, $budget]" (legacy planner-onboarding format)
 *   - Contains a planning verb AND a trip noun ("plan a trip", "let's organize a getaway")
 *   - Contains "trip to <Capitalized Place>" (e.g. "thinking about a trip to Tulum")
 */
function detectPlanningIntent(body: string): IntentHints | null {
  const trimmed = body.trim();
  if (trimmed.length < 4) return null;

  // Format A: "Name — destination[, dates, $budget]"
  const nameMatch = trimmed.match(/^([\p{L}][\p{L}'\-]{0,30})\s*[—–\-]\s*(.+)/u);
  if (nameMatch) {
    const plannerName = nameMatch[1].trim();
    const remainder = nameMatch[2].trim();
    const skipPatterns = /^(let'?s|adding|hey|help|plan|get|figure|want|think|going|i'?m|we)/i;
    const parts = remainder.split(',').map((p) => p.trim());
    const destRaw = parts[0];
    const destWords = destRaw.split(/\s+/).length;
    let destination: string | null = null;
    if (destWords <= 4 && destWords >= 1 && !skipPatterns.test(destRaw)) {
      destination = destRaw;
    }
    let dates: IntentHints['dates'] = null;
    let budget: number | null = null;
    for (const part of parts.slice(1)) {
      const dateMatch = part.match(/(\w+)\s+(\d{1,2})\s*[-–to]+\s*(\d{1,2})/i);
      if (dateMatch) {
        const months: Record<string, number> = {
          jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
          may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, september: 8,
          oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
        };
        const month = months[dateMatch[1].toLowerCase()];
        if (month !== undefined) {
          const year = new Date().getFullYear();
          const start = new Date(year, month, parseInt(dateMatch[2]));
          const end = new Date(year, month, parseInt(dateMatch[3]));
          if (start < new Date()) { start.setFullYear(year + 1); end.setFullYear(year + 1); }
          const nights = Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
          dates = {
            start: start.toISOString().split('T')[0],
            end: end.toISOString().split('T')[0],
            nights,
          };
        }
      }
      const budgetMatch = part.match(/\$\s*([\d,]+)/);
      if (budgetMatch) {
        const amount = parseFloat(budgetMatch[1].replace(',', ''));
        if (!isNaN(amount) && amount > 0) budget = amount;
      }
    }
    if (destination || dates || budget) {
      return { plannerName, destination, dates, budget };
    }
    // Name-only like "Sarah — hi" doesn't count as intent.
  }

  // Format B: planning verb + trip noun
  if (PLANNING_VERBS.test(trimmed) && TRIP_NOUNS.test(trimmed)) {
    const destMatch = trimmed.match(DESTINATION_PREP);
    return {
      plannerName: null,
      destination: destMatch ? destMatch[1].trim().replace(/[.,!?]+$/, '') : null,
      dates: null,
      budget: null,
    };
  }

  // Format C: bare "trip to <Place>"
  const tripToMatch = trimmed.match(/\btrip\s+to\s+([A-Z][\p{L}\-' ]{1,40})/u);
  if (tripToMatch) {
    return {
      plannerName: null,
      destination: tripToMatch[1].trim().replace(/[.,!?]+$/, ''),
      dates: null,
      budget: null,
    };
  }

  return null;
}

// ─── Welcome-back recap helper ──────────────────────────────────────────────

function buildWelcomeBackRecap(session: {
  destination: string | null;
  dates: { start: string; end: string } | null;
  budget_median: number | null;
  phase: string;
}): string {
  const parts: string[] = [];
  if (session.destination) parts.push(session.destination);
  if (session.dates?.start && session.dates?.end) {
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const start = new Date(session.dates.start + 'T12:00:00');
    const end = new Date(session.dates.end + 'T12:00:00');
    parts.push(`${months[start.getMonth()]} ${start.getDate()}\u2013${end.getDate()}`);
  }
  if (session.budget_median) parts.push(`~$${session.budget_median}/person`);
  const ctx = parts.join(', ');
  const phase = session.phase.replace(/_/g, ' ').toLowerCase();
  if (ctx) {
    return `Welcome back! Last we were at: ${ctx} (phase: ${phase}). Picking up where you left off \u2014`;
  }
  return `Welcome back! Picking up where you left off (phase: ${phase}) \u2014`;
}
