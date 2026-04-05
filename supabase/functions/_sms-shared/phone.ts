/**
 * Phone number normalization — E.164 format.
 *
 * Uses a lightweight regex approach instead of libphonenumber-js
 * (not available in Deno edge functions without bundling).
 * Handles US/CA numbers which is the MVP scope.
 */

/**
 * Normalize a phone number to E.164 format (+1XXXXXXXXXX for US/CA).
 * Returns null if the number cannot be normalized.
 */
export function normalizePhone(raw: string): string | null {
  if (!raw) return null;

  // Strip everything except digits and leading +
  const stripped = raw.replace(/[^\d+]/g, '');

  // Already E.164 with country code
  if (/^\+1\d{10}$/.test(stripped)) return stripped;

  // Has +country but not +1 — accept as-is if it looks valid (international)
  if (/^\+\d{7,15}$/.test(stripped)) return stripped;

  // 11 digits starting with 1 (US/CA without +)
  const digitsOnly = stripped.replace(/\+/g, '');
  if (/^1\d{10}$/.test(digitsOnly)) return `+${digitsOnly}`;

  // 10 digits (US/CA without country code)
  if (/^\d{10}$/.test(digitsOnly)) return `+1${digitsOnly}`;

  return null;
}

/**
 * Parse all participant phones from a Twilio group MMS `To` field.
 * Excludes the Rally bot number.
 */
export function parseParticipantPhones(
  toField: string,
  fromPhone: string,
  rallyPhone: string,
): string[] {
  // To field is comma-separated list of all recipients in the group thread
  const allPhones = toField
    .split(',')
    .map((p) => normalizePhone(p.trim()))
    .filter((p): p is string => p !== null);

  // Add the sender (From) — they're not in the To field
  const normalizedFrom = normalizePhone(fromPhone);
  if (normalizedFrom) allPhones.push(normalizedFrom);

  // Remove the Rally bot number and deduplicate
  const normalizedRally = normalizePhone(rallyPhone);
  const unique = [...new Set(allPhones)].filter((p) => p !== normalizedRally);

  return unique.sort();
}
