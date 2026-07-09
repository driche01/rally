/**
 * Twilio signature validation.
 *
 * Validates that the request actually came from Twilio by checking
 * the X-Twilio-Signature header against the request URL + body params.
 * See: https://www.twilio.com/docs/usage/security#validating-requests
 */

/**
 * Validate Twilio webhook signature.
 * Returns true if the signature matches.
 */
export async function validateTwilioSignature(
  authToken: string,
  signature: string,
  url: string,
  params: Record<string, string>,
): Promise<boolean> {
  // 1. Build the data string: URL + sorted params concatenated
  const sortedKeys = Object.keys(params).sort();
  let data = url;
  for (const key of sortedKeys) {
    data += key + params[key];
  }

  // 2. HMAC-SHA1 with auth token
  const encoder = new TextEncoder();
  const keyData = encoder.encode(authToken);
  const msgData = encoder.encode(data);

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );

  const sig = await crypto.subtle.sign('HMAC', cryptoKey, msgData);

  // 3. Base64 encode
  const computed = btoa(String.fromCharCode(...new Uint8Array(sig)));

  // 4. Constant-time compare. Plain `===` short-circuits on the first
  //    differing byte and leaks timing; compare the full length instead.
  return timingSafeEqual(computed, signature);
}

/**
 * Constant-time string equality. Compares every position regardless of
 * where the first mismatch is, so comparison time does not reveal how
 * many leading bytes matched. Length mismatch still returns false, but
 * only after a fixed-length scan of the computed value.
 */
function timingSafeEqual(a: string, b: string): boolean {
  const len = a.length;
  // Fold the length check into the accumulator so an early return can't
  // leak it. Any out-of-range index on `b` yields NaN → non-zero diff.
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    diff |= a.charCodeAt(i) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

/**
 * Parse a Twilio webhook POST body (application/x-www-form-urlencoded).
 * Returns a typed object with the key fields.
 */
export interface TwilioInboundMessage {
  MessageSid: string;
  From: string;
  To: string;
  Body: string;
  NumMedia: string;
  FriendlyName?: string;
  MediaUrl0?: string;
}

export function parseTwilioBody(body: URLSearchParams): TwilioInboundMessage {
  return {
    MessageSid: body.get('MessageSid') ?? '',
    From: body.get('From') ?? '',
    To: body.get('To') ?? '',
    Body: body.get('Body') ?? '',
    NumMedia: body.get('NumMedia') ?? '0',
    FriendlyName: body.get('FriendlyName') ?? undefined,
    MediaUrl0: body.get('MediaUrl0') ?? undefined,
  };
}
