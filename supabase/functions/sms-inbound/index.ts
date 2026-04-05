/**
 * Supabase Edge Function — sms-inbound
 *
 * Component 1: TwilioWebhookReceiver
 *
 * POST /sms-inbound
 * Receives all inbound MMS messages from Twilio, validates the signature,
 * checks idempotency, resolves users, and routes to MessageRouter.
 *
 * Deploy: supabase functions deploy sms-inbound
 */

import { getAdmin } from '../_sms-shared/supabase.ts';
import { validateTwilioSignature, parseTwilioBody } from '../_sms-shared/twilio.ts';
import { normalizePhone, parseParticipantPhones } from '../_sms-shared/phone.ts';
import { deriveThreadId } from '../_sms-shared/thread.ts';
import { findOrCreateUser, ensureRespondent } from '../_sms-shared/phone-user-linker.ts';
import {
  findSession,
  createSession,
  addParticipant,
  touchSession,
} from '../_sms-shared/trip-session.ts';
import { routeMessage } from '../_sms-shared/message-router.ts';
import type { RoutedMessage } from '../_sms-shared/message-router.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS });
  }

  const admin = getAdmin();
  const rallyPhone = Deno.env.get('TWILIO_PHONE_NUMBER') ?? '';
  // Support both toll-free and local numbers during transition
  const allRallyPhones = [rallyPhone, '+18559310010', '+16624283059'].filter(Boolean);
  const twilioAuthToken = Deno.env.get('TWILIO_AUTH_TOKEN') ?? '';

  try {
    // ─── Parse body ────────────────────────────────────────────────────────
    const rawBody = await req.text();
    const params = new URLSearchParams(rawBody);
    const msg = parseTwilioBody(params);

    if (!msg.MessageSid || !msg.From || !msg.To) {
      return jsonResponse({ error: 'Missing required fields' }, 400);
    }

    // ─── Validate Twilio signature ─────────────────────────────────────────
    // Twilio signs against the exact webhook URL configured on the phone number.
    // req.url reflects the internal Supabase proxy URL (different host/port),
    // so we must use the public URL for validation.
    const signature = req.headers.get('X-Twilio-Signature') ?? '';
    const publicUrl = 'https://qxpbnixvjtwckuedlrfj.supabase.co/functions/v1/sms-inbound';
    if (twilioAuthToken && signature) {
      const paramsObj: Record<string, string> = {};
      params.forEach((v, k) => { paramsObj[k] = v; });

      const valid = await validateTwilioSignature(twilioAuthToken, signature, publicUrl, paramsObj);
      if (!valid) {
        console.error('[sms-inbound] Invalid Twilio signature');
        return jsonResponse({ error: 'Invalid signature' }, 403);
      }
    }

    // ─── Idempotency check (thread_messages.message_sid is UNIQUE) ─────────
    const { data: existing } = await admin
      .from('thread_messages')
      .select('id')
      .eq('message_sid', msg.MessageSid)
      .maybeSingle();

    if (existing) {
      return jsonResponse({ status: 'duplicate', message_sid: msg.MessageSid });
    }

    // ─── Normalize phones ──────────────────────────────────────────────────
    const senderPhone = normalizePhone(msg.From);
    if (!senderPhone) {
      console.error(`[sms-inbound] Could not normalize phone: ${msg.From}`);
      return jsonResponse({ error: 'Invalid sender phone' }, 400);
    }

    // Parse participants, excluding all Rally phone numbers
    const allToPhones = msg.To.split(',').map((p) => normalizePhone(p.trim())).filter((p): p is string => p !== null);
    const allPhones = [...new Set([...allToPhones, senderPhone])];
    const rallySet = new Set(allRallyPhones.map((p) => normalizePhone(p)).filter(Boolean));
    const participantPhones = allPhones.filter((p) => !rallySet.has(p)).sort();

    // ─── 1:1 vs group thread detection ─────────────────────────────────────
    // Twilio long codes don't expose group participants in the To field.
    // Group MMS messages have SIDs starting with "MM", 1:1 SMS starts with "SM".
    const isGroupMms = msg.MessageSid.startsWith('MM');
    const is1to1 = !isGroupMms;

    // ─── Resolve user (Component 2: PhoneUserLinker) ───────────────────────
    const user = await findOrCreateUser(admin, senderPhone);

    // ─── Handle non-text MMS + detect URLs in body ─────────────────────────
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
        body = 'YES'; // Treat as booking confirmation
      } else {
        // Check if it's audio/voice memo
      const contentType = (msg as Record<string, string>).MediaContentType0 ?? '';
      if (contentType.startsWith('audio/')) {
        body = '[voice memo]';
      } else {
        body = '[image]';
      }
      }
    }

    // Detect Airbnb/VRBO wishlist or listing URLs in message body
    const wishlistMatch = body.match(/(https?:\/\/[^\s]*(airbnb\.com|vrbo\.com)[^\s]*)/i);
    if (wishlistMatch && session) {
      await admin.from('trip_sessions').update({
        wishlist_url: wishlistMatch[1],
        wishlist_shared_by_user_id: user.id,
      }).eq('id', session.id);
    }

    // ─── Derive thread_id and find/create session ──────────────────────────
    // Twilio long codes don't expose group MMS participant lists.
    // For group MMS: we look up sessions where this sender is a participant.
    // For new group threads: the first sender's message creates the session,
    // and other participants are added as they send messages.
    let session = null;
    let participant = null;
    let introResponse: string | null = null;

    if (!is1to1) {
      // Look for an active session where this sender is already a participant.
      // Two-step: find participant rows, then load the session.
      const { data: participantRows } = await admin
        .from('trip_session_participants')
        .select('id, trip_session_id, phone, display_name, status, committed, flight_status, is_planner, user_id, joined_at, updated_at')
        .eq('phone', senderPhone)
        .eq('status', 'active')
        .order('joined_at', { ascending: false });

      // Check each participant row for an active session
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
        await touchSession(admin, session.id);
      } else {
        // ─── No session for this sender — check for a session to join ─────
        // Twilio sends each group member's message as a separate webhook with
        // no group identifier. Join the most recent active session — in practice,
        // there's typically only one active planning session at a time.
        const { data: recentSessions } = await admin
          .from('trip_sessions')
          .select('*')
          .eq('status', 'ACTIVE')
          .order('created_at', { ascending: false })
          .limit(1);

        if (recentSessions && recentSessions.length > 0) {
          // Join the existing recent session
          session = recentSessions[0];
          participant = await addParticipant(admin, session.id, user, false);
          if (session.trip_id) {
            await ensureRespondent(admin, session.trip_id, user);
          }
          await touchSession(admin, session.id);

          // Extract name + destination from merge participant's message
          const mergeNameMatch = body.match(/^([\p{L}][\p{L}'\-]{0,30})\s*[—–\-]\s*(.+)/u);
          if (mergeNameMatch) {
            const mName = mergeNameMatch[1].trim();
            const mDest = mergeNameMatch[2].trim();
            await admin.from('users').update({ display_name: mName }).eq('id', user.id);
            await admin.from('trip_session_participants')
              .update({ display_name: mName })
              .eq('trip_session_id', session.id).eq('user_id', user.id);
            if (session.trip_id) {
              await admin.from('respondents').update({ name: mName })
                .eq('trip_id', session.trip_id).eq('phone', user.phone);
            }
          }
        } else {
          // ─── Truly new session ─────────────────────────────────────────
          const threadId = await deriveThreadId([senderPhone, `group_${Date.now()}`]);

          // Check if sender is a pending planner
          const { data: pendingPlanners } = await admin
            .from('pending_planners')
            .select('phone')
            .eq('phone', senderPhone)
            .limit(1);

          session = await createSession(admin, threadId, user, msg.FriendlyName ?? null);

          // Add sender as first participant (and planner)
          await addParticipant(admin, session.id, user, true);
          if (session.trip_id) {
            await ensureRespondent(admin, session.trip_id, user);
          }

          // Extract planner name + destination from first message ("Jake — Tulum")
          // Also detect dates and budget if included ("Jake — Tulum, Nov 8-12, $1250pp")
          const nameMatch = body.match(/^([\p{L}][\p{L}'\-]{0,30})\s*[—–\-]\s*(.+)/u);
          if (nameMatch) {
            const plannerName = nameMatch[1].trim();
            const remainder = nameMatch[2].trim();
            await admin.from('users').update({ display_name: plannerName }).eq('id', user.id);
            await admin
              .from('trip_session_participants')
              .update({ display_name: plannerName })
              .eq('trip_session_id', session.id)
              .eq('user_id', user.id);
            if (session.trip_id) {
              await admin
                .from('respondents')
                .update({ name: plannerName })
                .eq('trip_id', session.trip_id)
                .eq('phone', user.phone);
            }

            // Parse remainder for destination, dates, budget
            // Split on commas to separate components
            const parts = remainder.split(',').map((p) => p.trim());
            const plannerDest = parts[0]; // First part is always destination
            const sessionUpdates: Record<string, unknown> = {
              destination_candidates: [{ label: plannerDest, votes: 1 }],
            };

            // Check remaining parts for dates and budget
            for (const part of parts.slice(1)) {
              // Date pattern: "Nov 8-12", "November 8 to 12"
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
              // Budget pattern: "$1250", "$1,250/person", "around $1250pp"
              const budgetMatch = part.match(/\$\s*([\d,]+)/);
              if (budgetMatch) {
                const amount = parseFloat(budgetMatch[1].replace(',', ''));
                if (!isNaN(amount) && amount > 0) {
                  sessionUpdates.budget_median = amount;
                  sessionUpdates.budget_status = 'ALIGNED';
                }
              }
            }

            await admin.from('trip_sessions').update(sessionUpdates).eq('id', session.id);
          }

          // Build intro response
          introResponse =
            `Hey! I'm Rally \ud83d\udc4b I'll get this group to first booking as fast as possible. ` +
            `Drop your name and where you're thinking for this trip \u2014 ` +
            `I'll take it from there. Reply STOP anytime to opt out.`;
        } // end truly new session
      } // end no existing session for sender
    } // end group MMS

    // ─── Store inbound message ─────────────────────────────────────────────
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

    // ─── Route message ─────────────────────────────────────────────────────
    const routed: RoutedMessage = {
      type: is1to1 ? '1to1' : session ? 'phase' : 'new_session',
      body,
      fromUser: user,
      session,
      participant,
      is1to1,
    };

    // Route the message — skip if we already have an intro (new session just created)
    let response: string | null = null;
    if (introResponse) {
      // New session — return the intro. The name+destination were already
      // extracted during session creation. Don't call routeMessage which
      // would try to process the message again against the fresh session.
      response = introResponse;
    } else {
      response = await routeMessage(admin, routed);
    }

    // ─── Store outbound message if we have a response ──────────────────────
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

    // ─── Return TwiML response ─────────────────────────────────────────────
    if (response) {
      const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(response)}</Message></Response>`;
      return new Response(twiml, {
        headers: { ...CORS_HEADERS, 'Content-Type': 'text/xml' },
      });
    }

    // No response needed — return empty TwiML
    return new Response(
      '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
      { headers: { ...CORS_HEADERS, 'Content-Type': 'text/xml' } },
    );
  } catch (err) {
    console.error('[sms-inbound] Error:', err);
    const errMsg = err instanceof Error ? err.message : String(err);
    return new Response(
      `<?xml version="1.0" encoding="UTF-8"?><Response><Message>Error: ${escapeXml(errMsg.slice(0, 200))}</Message></Response>`,
      { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'text/xml' } },
    );
  }
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
