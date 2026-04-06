/**
 * Thread ID derivation — deterministic hash from sorted participant phones.
 *
 * Same set of participants always produces the same thread_id,
 * regardless of message order.
 */

/**
 * Derive a stable thread_id from a sorted list of participant phone numbers.
 * Uses SHA-256, truncated to 32 hex chars.
 */
export async function deriveThreadId(participantPhones: string[]): Promise<string> {
  const sorted = [...participantPhones].sort();
  const payload = sorted.join(',');

  const encoder = new TextEncoder();
  const data = encoder.encode(payload);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

  return hashHex.slice(0, 32);
}
