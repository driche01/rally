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

    // ─── Handle non-text MMS ───────────────────────────────────────────────
    let body = msg.Body.trim();
    const hasMedia = parseInt(msg.NumMedia) > 0;
    if (hasMedia && !body) {
      // Check for booking URL patterns in media
      const bookingPatterns = [
        'google.com/flights', 'airbnb.com', 'vrbo.com',
        'delta.com', 'united.com', 'southwest.com', 'jetblue.com',
        'booking.com', 'expedia.com',
      ];
      const mediaUrl = msg.MediaUrl0 ?? '';
      const isBooking = bookingPatterns.some((p) => mediaUrl.includes(p));

      if (isBooking) {
        body = 'YES'; // Treat as booking confirmation
      } else {
        body = '[image]'; // Acknowledge but don't parse
      }
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
          const mergeNameMatch = body.match(/^([A-Za-z]+)\s*[—–-]\s*(.+)/);
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
          const nameMatch = body.match(/^([A-Za-z]+)\s*[—–-]\s*(.+)/);
          if (nameMatch) {
            const plannerName = nameMatch[1].trim();
            const plannerDest = nameMatch[2].trim();
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
            // Store destination as first candidate
            await admin
              .from('trip_sessions')
              .update({ destination_candidates: [{ label: plannerDest, votes: 1 }] })
              .eq('id', session.id);
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

    let response = introResponse ?? (await routeMessage(admin, routed));

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
    // Return a valid TwiML response even on error — Twilio needs 200 + valid XML
    // to avoid 11200 errors
    return new Response(
      '<?xml version="1.0" encoding="UTF-8"?><Response><Message>Got it — give me a moment.</Message></Response>',
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
