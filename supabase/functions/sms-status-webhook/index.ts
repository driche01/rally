/**
 * Supabase Edge Function — sms-status-webhook
 *
 * Twilio StatusCallback receiver. Twilio POSTs here every time a
 * message's delivery status changes (queued → sending → sent →
 * delivered, or → failed/undelivered). Body is form-encoded:
 *
 *   MessageSid=SMxxxx
 *   MessageStatus=delivered|failed|undelivered|sent|queued|sending
 *   ErrorCode=30005   (only on failure)
 *   To=+1...
 *   From=+1...
 *
 * We persist (status, status_at, error_code) onto the matching
 * thread_messages row, looked up by message_sid.
 *
 * Configure Twilio side: in Messaging Service > Integration set
 *   Status Callback URL: https://qxpbnixvjtwckuedlrfj.supabase.co/functions/v1/sms-status-webhook
 *
 * Deploy: supabase functions deploy sms-status-webhook --no-verify-jwt
 *         (Twilio doesn't send our JWT — it's signature-validated.)
 */

import { getAdmin } from '../_sms-shared/supabase.ts';
import { validateTwilioSignature } from '../_sms-shared/twilio.ts';
import { captureError } from '../_sms-shared/telemetry.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-twilio-signature, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS });

  try {
    const rawBody = await req.text();
    const params = new URLSearchParams(rawBody);

    const messageSid = params.get('MessageSid') ?? '';
    const status = params.get('MessageStatus') ?? '';
    const errorCode = params.get('ErrorCode') ?? null;

    if (!messageSid || !status) {
      return new Response('missing_fields', { status: 400, headers: CORS_HEADERS });
    }

    // Twilio signature validation. The webhook URL Twilio is configured
    // to call must match what we sign against. Skip in dev if no auth
    // token configured.
    const twilioAuthToken = Deno.env.get('TWILIO_AUTH_TOKEN') ?? '';
    const signature = req.headers.get('X-Twilio-Signature') ?? '';
    const publicUrl = 'https://qxpbnixvjtwckuedlrfj.supabase.co/functions/v1/sms-status-webhook';
    if (twilioAuthToken && signature) {
      const paramsObj: Record<string, string> = {};
      params.forEach((v, k) => { paramsObj[k] = v; });
      const valid = await validateTwilioSignature(twilioAuthToken, signature, publicUrl, paramsObj);
      if (!valid) {
        console.error('[sms-status-webhook] invalid signature for', messageSid);
        return new Response('invalid_signature', { status: 403, headers: CORS_HEADERS });
      }
    }

    const admin = getAdmin();
    const { error } = await admin
      .from('thread_messages')
      .update({
        delivery_status: status,
        delivery_status_at: new Date().toISOString(),
        error_code: errorCode,
      })
      .eq('message_sid', messageSid);
    if (error) {
      console.error('[sms-status-webhook] update failed:', error.message);
    }

    // Twilio expects a 200 response (any body). Return TwiML-style empty.
    return new Response(
      '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
      { headers: { ...CORS_HEADERS, 'Content-Type': 'text/xml' } },
    );
  } catch (err) {
    console.error('[sms-status-webhook] fatal:', err);
    captureError(err, { component: 'sms-status-webhook' }).catch(() => {});
    return new Response('error', { status: 500, headers: CORS_HEADERS });
  }
});
