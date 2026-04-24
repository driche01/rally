/**
 * Supabase Edge Function — sms-inbound
 *
 * Component 1: TwilioWebhookReceiver
 *
 * POST /sms-inbound
 * Receives all inbound MMS messages from Twilio, validates the signature,
 * and delegates to processInboundMessage for all business logic.
 *
 * Deploy: supabase functions deploy sms-inbound
 */

import { getAdmin } from '../_sms-shared/supabase.ts';
import { validateTwilioSignature, parseTwilioBody } from '../_sms-shared/twilio.ts';
import { processInboundMessage } from '../_sms-shared/inbound-processor.ts';
import { captureError } from '../_sms-shared/telemetry.ts';

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

    // ─── Delegate to processor ─────────────────────────────────────────────
    const result = await processInboundMessage(admin, msg, allRallyPhones);

    // ─── Return TwiML response ─────────────────────────────────────────────
    if (result.response) {
      const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(result.response)}</Message></Response>`;
      return new Response(twiml, {
        headers: { ...CORS_HEADERS, 'Content-Type': 'text/xml' },
      });
    }

    return new Response(
      '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
      { headers: { ...CORS_HEADERS, 'Content-Type': 'text/xml' } },
    );
  } catch (err) {
    console.error('[sms-inbound] Error:', err);
    // Fire-and-forget Sentry capture (no-op if SENTRY_DSN unset)
    captureError(err, { component: 'sms-inbound' }).catch(() => {});
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
