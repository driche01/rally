/**
 * Personalize a message body with per-recipient placeholders.
 *
 * Currently supports:
 *   [Name]       → recipient's first name (current placeholder)
 *   [Their name] → recipient's first name (legacy placeholder, still
 *                  honored so older trips with custom_intro_sms saved
 *                  pre-rename keep working)
 *
 * Either falls back to "there" when no name is on file.
 *
 * Used by:
 *   - `_sms-shared/dm-sender.ts` `broadcast()` — per-participant fan-out
 *   - `sms-nudge-scheduler` for the custom_intro_sms override
 *
 * Pure function. Safe to call on bodies that don't contain the
 * placeholder — returns the input unchanged.
 */

// Match both [Name] and [Their name] (case-insensitive).
const RECIPIENT_PLACEHOLDER = /\[(?:Name|Their name)\]/gi;

function firstName(name: string | null | undefined): string | null {
  if (!name) return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  return trimmed.split(/\s+/)[0];
}

export function personalizeBody(
  body: string,
  recipientName: string | null | undefined,
): string {
  if (!body) return body;
  const fname = firstName(recipientName);
  // When we don't have a name, drop the placeholder gracefully —
  // "Hey there — ..." reads more naturally than "Hey friend".
  return body.replace(RECIPIENT_PLACEHOLDER, fname ?? 'there');
}
