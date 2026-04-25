/**
 * Phone number normalization — E.164 format.
 *
 * Client-side mirror of `supabase/functions/_sms-shared/phone.ts`.
 * Keep the two in sync: this must produce the same E.164 output for the
 * same input so a phone typed into the app or the survey matches the
 * phone recorded by the SMS agent.
 *
 * Lightweight regex approach (no libphonenumber-js) — US/CA is the MVP
 * scope; other countries are accepted as-is if they already have a +cc prefix.
 */

/**
 * Normalize a phone number to E.164 format (+1XXXXXXXXXX for US/CA).
 * Returns null if the number cannot be normalized.
 *
 * Accepted inputs (all produce `+14155551212`):
 *   "4155551212", "415 555 1212", "(415) 555-1212",
 *   "14155551212", "1-415-555-1212", "+14155551212"
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;

  // Strip everything except digits and leading +
  const stripped = raw.replace(/[^\d+]/g, '');

  // Already E.164 with country code +1 (US/CA)
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
