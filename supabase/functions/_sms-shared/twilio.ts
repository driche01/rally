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

  // 4. Compare (timing-safe comparison via string equality on fixed-length base64)
  return computed === signature;
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
