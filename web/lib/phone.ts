/**
 * Phone normalization — E.164 (+1XXXXXXXXXX for US/CA).
 *
 * Mirrors supabase/functions/_sms-shared/phone.ts so the web API
 * and edge functions agree. Web-side duplication is intentional;
 * the alternative (importing from Deno-flavored shared module)
 * needs more build glue than it saves.
 */

export function normalizePhone(raw: string): string | null {
  if (!raw) return null;
  const stripped = raw.replace(/[^\d+]/g, "");
  if (/^\+1\d{10}$/.test(stripped)) return stripped;
  if (/^\+\d{7,15}$/.test(stripped)) return stripped;
  const digitsOnly = stripped.replace(/\+/g, "");
  if (/^1\d{10}$/.test(digitsOnly)) return `+${digitsOnly}`;
  if (/^\d{10}$/.test(digitsOnly))  return `+1${digitsOnly}`;
  return null;
}
