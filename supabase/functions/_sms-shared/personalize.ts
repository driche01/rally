/**
 * Personalize a message body with per-recipient placeholders.
 *
 * Supported tokens (case-insensitive):
 *   [Name]        → recipient's first name (modern alias)
 *   [Their name]  → recipient's first name (legacy alias for older
 *                   trips that saved custom_intro_sms pre-rename)
 *   [Planner]     → planner's first name
 *   [Destination] → trip destination
 *   [Trip]        → trip name (falls back to destination, then "the trip")
 *
 * Each placeholder falls back gracefully when the value isn't on file
 * so messages never go out with a literal "[Name]" or "undefined".
 *
 * Used by:
 *   - `_sms-shared/dm-sender.ts` `broadcast()` — per-participant fan-out
 *   - `sms-nudge-scheduler` for the custom_intro_sms override
 *
 * Pure function. Safe to call on bodies that don't contain any
 * placeholder — returns the input unchanged.
 */

const RECIPIENT_PLACEHOLDER = /\[(?:Name|Their name)\]/gi;
const PLANNER_PLACEHOLDER = /\[Planner\]/gi;
const DESTINATION_PLACEHOLDER = /\[Destination\]/gi;
const TRIP_PLACEHOLDER = /\[Trip\]/gi;

function firstName(name: string | null | undefined): string | null {
  if (!name) return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  return trimmed.split(/\s+/)[0];
}

export interface PersonalizeContext {
  recipientName?: string | null;
  plannerName?: string | null;
  destination?: string | null;
  tripName?: string | null;
}

/**
 * Substitute all supported tokens. The two-arg legacy form (string | null)
 * is still honored so old callers don't break.
 */
export function personalizeBody(
  body: string,
  ctxOrName: PersonalizeContext | string | null | undefined,
): string {
  if (!body) return body;

  const ctx: PersonalizeContext =
    typeof ctxOrName === 'string' || ctxOrName === null || ctxOrName === undefined
      ? { recipientName: ctxOrName ?? null }
      : ctxOrName;

  const recipient = firstName(ctx.recipientName) ?? 'there';
  const planner = firstName(ctx.plannerName) ?? 'your planner';
  const destination = (ctx.destination ?? '').trim() || 'the destination';
  const trip = (ctx.tripName ?? '').trim()
    || (ctx.destination ?? '').trim()
    || 'the trip';

  return body
    .replace(RECIPIENT_PLACEHOLDER, recipient)
    .replace(PLANNER_PLACEHOLDER, planner)
    .replace(DESTINATION_PLACEHOLDER, destination)
    .replace(TRIP_PLACEHOLDER, trip);
}
