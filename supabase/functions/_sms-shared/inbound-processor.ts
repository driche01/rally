/**
 * Core inbound message processing logic, extracted from sms-inbound/index.ts
 * for testability. The HTTP handler in index.ts is now a thin wrapper that
 * parses the request, validates the Twilio signature, and calls this function.
 *
 * This module has zero HTTP concerns — it takes parsed inputs and returns
 * a response string (or null).
 */

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { normalizePhone } from './phone.ts';
import { deriveThreadId } from './thread.ts';
import { findOrCreateUser, ensureRespondent } from './phone-user-linker.ts';
import {
  findSession,
  createSession,
  addParticipant,
  touchSession,
} from './trip-session.ts';
import { routeMessage } from './message-router.ts';
import type { RoutedMessage } from './message-router.ts';
import { track } from './telemetry.ts';

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

/**
 * Process a single inbound SMS/MMS message through the full pipeline.
 * Returns the bot's response text (or null if no response needed).
 */
export async function processInboundMessage(
  admin: SupabaseClient,
  msg: ParsedTwilioMessage,
  allRallyPhones: string[],
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

  // ─── Normalize phones ───────────────────────────────────────────────────
  const senderPhone = normalizePhone(msg.From);
  if (!senderPhone) {
    return { response: null, sessionId: null, phase: null };
  }

  const allToPhones = msg.To.split(',').map((p) => normalizePhone(p.trim())).filter((p): p is string => p !== null);
  const allPhones = [...new Set([...allToPhones, senderPhone])];
  const rallySet = new Set(allRallyPhones.map((p) => normalizePhone(p)).filter(Boolean));
  const participantPhones = allPhones.filter((p) => !rallySet.has(p)).sort();

  // ─── 1:1 vs group detection ─────────────────────────────────────────────
  const isGroupMms = msg.MessageSid.startsWith('MM');
  const is1to1 = !isGroupMms;

  // ─── Resolve user ───────────────────────────────────────────────────────
  const user = await findOrCreateUser(admin, senderPhone);

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
      if (contentType.startsWith('audio/')) {
        body = '[voice memo]';
      } else {
        body = '[image]';
      }
    }
  }

  // ─── Find or create session ─────────────────────────────────────────────
  let session = null;
  let participant = null;
  let introResponse: string | null = null;
  // Captured before touchSession() overwrites it — drives the welcome-back recap.
  let priorLastMessageAt: string | null = null;

  if (!is1to1) {
    // Look for an active session where this sender is already a participant
    const { data: participantRows } = await admin
      .from('trip_session_participants')
      .select('*')
      .eq('phone', senderPhone)
      .eq('status', 'active')
      .order('joined_at', { ascending: false });

    let foundSession = null;
    let foundParticipant = null;
    for (const pRow of participantRows ?? []) {
      const { data: sess } = await admin
        .from('trip_sessions')
        .select('*')
        .eq('id', pRow.trip_session_id)
        .in('status', ['ACTIVE', 'PAUSED', 'RE_ENGAGEMENT_PENDING', 'FIRST_BOOKING_REACHED'])
        .maybeSingle();
      if (sess) {
        foundSession = sess;
        foundParticipant = pRow;
        break;
      }
    }

    if (foundSession) {
      session = foundSession;
      participant = foundParticipant;
      priorLastMessageAt = (session as { last_message_at?: string | null }).last_message_at ?? null;
      await touchSession(admin, session.id);
    } else {
      // Check for a recent session where at least one of the message's
      // participant phones already exists — prevents unrelated groups from merging
      const { data: recentSessions } = await admin
        .from('trip_sessions')
        .select('*')
        .eq('status', 'ACTIVE')
        .order('created_at', { ascending: false })
        .limit(5);

      let matchedSession = null;
      for (const candidate of recentSessions ?? []) {
        const { data: existingParticipants } = await admin
          .from('trip_session_participants')
          .select('phone')
          .eq('trip_session_id', candidate.id)
          .eq('status', 'active');
        const existingPhones = new Set((existingParticipants ?? []).map((p: { phone: string }) => p.phone));
        // At least one phone from this message's group must already be in the session
        const hasOverlap = participantPhones.some((p) => existingPhones.has(p));
        if (hasOverlap) {
          matchedSession = candidate;
          break;
        }
      }

      if (matchedSession) {
        session = matchedSession;

        // Check if user is already a participant (possibly opted_out)
        const { data: existingP } = await admin
          .from('trip_session_participants')
          .select('*')
          .eq('trip_session_id', session.id)
          .eq('user_id', user.id)
          .maybeSingle();

        if (existingP) {
          // User was already in this session (possibly opted_out) — don't re-add
          participant = existingP;
          await touchSession(admin, session.id);
        } else {
          participant = await addParticipant(admin, session.id, user, false);
          if (session.trip_id) {
            await ensureRespondent(admin, session.trip_id, user);
          }
          await touchSession(admin, session.id);

          // Extract name + destination from joining participant's message
          const mergeNameMatch = body.match(/^([\p{L}][\p{L}'\-]{0,30})\s*[—–\-]\s*(.+)/u);
          if (mergeNameMatch) {
            const mName = mergeNameMatch[1].trim();
            await admin.from('users').update({ display_name: mName }).eq('id', user.id);
            await admin.from('trip_session_participants')
              .update({ display_name: mName })
              .eq('trip_session_id', session.id).eq('user_id', user.id);
            if (session.trip_id) {
              await admin.from('respondents').update({ name: mName })
                .eq('trip_id', session.trip_id).eq('phone', user.phone);
            }
          }

          // Catch-up message if session is past INTRO
          if (session.phase !== 'INTRO') {
            const catchUpParts: string[] = ['Welcome to the group! Here\'s where we\'re at:'];
            if (session.destination) catchUpParts.push(`Destination: ${session.destination}`);
            if (session.dates) catchUpParts.push(`Dates: ${(session.dates as { start: string; end: string }).start}\u2013${(session.dates as { start: string; end: string }).end}`);
            catchUpParts.push(`Current phase: ${session.phase.replace(/_/g, ' ').toLowerCase()}`);
            catchUpParts.push('Jump in anytime \u2014 reply HELP if you need commands.');
            introResponse = catchUpParts.join('\n');
          }
        }
      } else {
        // ─── Truly new session ────────────────────────────────────────────
        const threadId = await deriveThreadId([senderPhone, `group_${Date.now()}`]);

        session = await createSession(admin, threadId, user, msg.FriendlyName ?? null);
        await addParticipant(admin, session.id, user, true);
        if (session.trip_id) {
          await ensureRespondent(admin, session.trip_id, user);
        }

        // Extract planner name + destination + dates + budget
        const nameMatch = body.match(/^([\p{L}][\p{L}'\-]{0,30})\s*[—–\-]\s*(.+)/u);
        if (nameMatch) {
          const plannerName = nameMatch[1].trim();
          const remainder = nameMatch[2].trim();
          await admin.from('users').update({ display_name: plannerName }).eq('id', user.id);
          await admin.from('trip_session_participants')
            .update({ display_name: plannerName })
            .eq('trip_session_id', session.id).eq('user_id', user.id);
          if (session.trip_id) {
            await admin.from('respondents').update({ name: plannerName })
              .eq('trip_id', session.trip_id).eq('phone', user.phone);
          }

          const parts = remainder.split(',').map((p) => p.trim());
          const plannerDestRaw = parts[0];
          // deno-lint-ignore no-explicit-any
          const sessionUpdates: Record<string, any> = {};

          const destWords = plannerDestRaw.split(/\s+/).length;
          if (destWords <= 4 && destWords >= 1) {
            const skipPatterns = /^(let'?s|adding|hey|help|plan|get|figure|want|think|going|i'?m|we)/i;
            if (!skipPatterns.test(plannerDestRaw)) {
              sessionUpdates.destination_candidates = [{ label: plannerDestRaw, votes: 1 }];
            }
          }

          for (const part of parts.slice(1)) {
            const dateMatch = part.match(/(\w+)\s+(\d{1,2})\s*[-–to]+\s*(\d{1,2})/i);
            if (dateMatch) {
              const months: Record<string, number> = {
                jan:0,january:0,feb:1,february:1,mar:2,march:2,apr:3,april:3,
                may:4,jun:5,june:5,jul:6,july:6,aug:7,august:7,sep:8,september:8,
                oct:9,october:9,nov:10,november:10,dec:11,december:11,
              };
              const month = months[dateMatch[1].toLowerCase()];
              if (month !== undefined) {
                const year = new Date().getFullYear();
                const start = new Date(year, month, parseInt(dateMatch[2]));
                const end = new Date(year, month, parseInt(dateMatch[3]));
                if (start < new Date()) { start.setFullYear(year + 1); end.setFullYear(year + 1); }
                const nights = Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
                sessionUpdates.dates = { start: start.toISOString().split('T')[0], end: end.toISOString().split('T')[0], nights };
              }
            }
            const budgetMatch = part.match(/\$\s*([\d,]+)/);
            if (budgetMatch) {
              const amount = parseFloat(budgetMatch[1].replace(',', ''));
              if (!isNaN(amount) && amount > 0) {
                sessionUpdates.budget_median = amount;
                sessionUpdates.budget_status = 'ALIGNED';
              }
            }
          }

          if (Object.keys(sessionUpdates).length > 0) {
            await admin.from('trip_sessions').update(sessionUpdates).eq('id', session.id);
          }
        }

        // Detect wishlist URL
        const wishlistMatch = body.match(/(https?:\/\/[^\s]*(airbnb\.com|vrbo\.com)[^\s]*)/i);
        if (wishlistMatch && session?.id) {
          await admin.from('trip_sessions').update({
            wishlist_url: wishlistMatch[1],
            wishlist_shared_by_user_id: user.id,
          }).eq('id', session.id);
        }

        introResponse =
          `Hey! I'm Rally \ud83d\udc4b I help groups plan trips fast. ` +
          `Everyone drop your name and a destination you'd wanna hit \u2014 ` +
          `format it like "Name \u2014 destination". Reply STOP anytime to opt out.`;

        // Telemetry: new SMS session created
        track('sms_session_created', {
          distinct_id: session.id,
          sessionId: session.id,
          plannerUserId: user.id,
          threadName: msg.FriendlyName ?? null,
        }).catch(() => {});
      }
    }
  }

  // ─── Store inbound message ──────────────────────────────────────────────
  const threadId = is1to1 ? `1to1_${senderPhone}` : session?.thread_id ?? 'unknown';
  await admin.from('thread_messages').insert({
    thread_id: threadId,
    trip_session_id: session?.id ?? null,
    direction: 'inbound',
    sender_phone: senderPhone,
    sender_role: participant?.is_planner ? 'planner' : 'participant',
    body,
    message_sid: msg.MessageSid,
    media_url: msg.MediaUrl0 ?? null,
  });

  // ─── Route message ──────────────────────────────────────────────────────
  const routed: RoutedMessage = {
    type: is1to1 ? '1to1' : session ? 'phase' : 'new_session',
    body,
    fromUser: user,
    session,
    participant,
    is1to1,
  };

  let response: string | null = null;
  if (introResponse) {
    response = introResponse;
  } else {
    response = await routeMessage(admin, routed);
  }

  // ─── Welcome-back recap (P3-7) ─────────────────────────────────────────
  // If the session was idle >7 days and we haven't already sent a recap
  // for this gap, prepend a short recap to whatever response we're sending.
  // Stays silent if the response was silent (we don't spam after long gaps).
  if (response && session && priorLastMessageAt && !is1to1) {
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
    const idleMs = Date.now() - new Date(priorLastMessageAt).getTime();
    const dormantPhases = ['COMPLETE', 'CANCELLED', 'ABANDONED'];
    const recapEligible =
      idleMs >= SEVEN_DAYS_MS &&
      !dormantPhases.includes(session.phase) &&
      session.status !== 'RE_ENGAGEMENT_PENDING';
    if (recapEligible) {
      const wbSentAt = (session as { welcome_back_sent_at?: string | null }).welcome_back_sent_at;
      // Only fire once per gap: skip if we already sent a recap AFTER the gap started
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
      thread_id: threadId,
      trip_session_id: session?.id ?? null,
      direction: 'outbound',
      sender_phone: null,
      sender_role: 'rally',
      body: response,
      message_sid: null,
    });
  }

  // Reload session for current phase
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

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Build a one-line recap for the "welcome back" prefix shown when a
 * participant messages after >7 days of silence.
 */
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
