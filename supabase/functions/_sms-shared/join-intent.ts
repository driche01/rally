/**
 * Join-link confirmation intent matcher.
 *
 * When a phone with a pending join_link_submission texts back, we need to
 * decide whether their reply is YES (confirm), NO (decline), or something
 * else (let normal routing handle it). Conservative on YES so we don't
 * accidentally promote a participant who typed "yeah idk" — they need to
 * type something unambiguous.
 *
 * STOP intentionally falls through to the existing keyword handler so the
 * standard opt-out path runs (see message-router.ts KEYWORDS table).
 */

const YES_PATTERNS = [
  /^y$/i,
  /^yes$/i,
  /^yes!+$/i,
  /^yeah$/i,
  /^yep$/i,
  /^yup$/i,
  /^sure$/i,
  /^ok$/i,
  /^okay$/i,
  /^i'?m\s+in$/i,
  /^im\s+in$/i,
  /^count\s+me\s+in$/i,
  /^join$/i,
  /^confirm$/i,
];

const NO_PATTERNS = [
  /^n$/i,
  /^no$/i,
  /^nope$/i,
  /^nah$/i,
  /^not\s+interested$/i,
  /^pass$/i,
  /^decline$/i,
  /^can'?t$/i,
];

export type JoinIntent = 'confirmed' | 'declined' | null;

export function matchJoinConfirmIntent(body: string): JoinIntent {
  const trimmed = body.trim();
  if (!trimmed) return null;
  for (const re of YES_PATTERNS) if (re.test(trimmed)) return 'confirmed';
  for (const re of NO_PATTERNS)  if (re.test(trimmed)) return 'declined';
  return null;
}
