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
    const signature = req.headers.get('X-Twilio-Signature') ?? '';
    const requestUrl = Deno.env.get('RALLY_BASE_URL')
      ? `${Deno.env.get('RALLY_BASE_URL')}/functions/v1/sms-inbound`
      : req.url;

    if (twilioAuthToken && signature) {
      const paramsObj: Record<string, string> = {};
      params.forEach((v, k) => { paramsObj[k] = v; });

      const valid = await validateTwilioSignature(twilioAuthToken, signature, requestUrl, paramsObj);
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

    const participantPhones = parseParticipantPhones(msg.To, msg.From, rallyPhone);

    // ─── 1:1 vs group thread detection ─────────────────────────────────────
    const is1to1 = participantPhones.length === 1; // Only sender (no other participants)

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
    let session = null;
    let participant = null;
    let introResponse: string | null = null;

    if (!is1to1) {
      const threadId = await deriveThreadId(participantPhones);
      session = await findSession(admin, threadId);

      if (!session) {
        // ─── New group thread — create session ───────────────────────────
        // Check pending_planners for any participant
        let plannerUser = user; // Default: first message sender
        const { data: pendingPlanners } = await admin
          .from('pending_planners')
          .select('phone')
          .in('phone', participantPhones)
          .order('registered_at', { ascending: false })
          .limit(1);

        if (pendingPlanners && pendingPlanners.length > 0) {
          const plannerPhone = pendingPlanners[0].phone;
          if (plannerPhone !== senderPhone) {
            plannerUser = await findOrCreateUser(admin, plannerPhone);
          }
        }

        session = await createSession(admin, threadId, plannerUser, msg.FriendlyName ?? null);

        // Add all participants
        for (const phone of participantPhones) {
          const pUser = phone === senderPhone ? user : await findOrCreateUser(admin, phone);
          const isPlanner = pUser.id === plannerUser.id;
          await addParticipant(admin, session.id, pUser, isPlanner);
          // Ensure respondent row exists on the linked trip
          if (session.trip_id) {
            await ensureRespondent(admin, session.trip_id, pUser);
          }
        }

        // Extract planner name from first message ("Jake — Tulum")
        const nameMatch = body.match(/^([A-Za-z]+)\s*[—–-]\s*(.+)/);
        if (nameMatch) {
          const plannerName = nameMatch[1].trim();
          await admin.from('users').update({ display_name: plannerName }).eq('id', plannerUser.id);
          await admin
            .from('trip_session_participants')
            .update({ display_name: plannerName })
            .eq('trip_session_id', session.id)
            .eq('user_id', plannerUser.id);
          if (session.trip_id) {
            await admin
              .from('respondents')
              .update({ name: plannerName })
              .eq('trip_id', session.trip_id)
              .eq('phone', plannerUser.phone);
          }
        }

        // Build intro response
        if (user.returning && user.display_name) {
          introResponse =
            `Hey everyone \u2014 I'm Rally, here to help plan the trip. ` +
            `${user.display_name}, good to have you back. ` +
            `Everyone else: drop your name and your destination ideas and let's get going. ` +
            `Reply STOP anytime to opt out.`;
        } else {
          introResponse =
            `Hey! I'm Rally \ud83d\udc4b I'll get this group to first booking as fast as possible. ` +
            `Drop your name and where you're thinking for this trip \u2014 ` +
            `I'll take it from there. Reply STOP anytime to opt out.`;
        }
      } else {
        // ─── Existing session ────────────────────────────────────────────
        // Find or add participant
        const { data: existingP } = await admin
          .from('trip_session_participants')
          .select('*')
          .eq('trip_session_id', session.id)
          .eq('phone', senderPhone)
          .maybeSingle();

        if (existingP) {
          participant = existingP;
        } else {
          // New participant joining mid-session
          participant = await addParticipant(admin, session.id, user, false);
          if (session.trip_id) {
            await ensureRespondent(admin, session.trip_id, user);
          }
        }

        await touchSession(admin, session.id);
      }
    }

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
    return new Response(
      '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
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
