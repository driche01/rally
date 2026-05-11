/**
 * /api/trips/[id]/invitations
 *   POST — planner sends invitations to a list of recipients.
 *
 * STATUS: stubbed.
 *
 * Full implementation lands in build guide §6 Step 6 (Send
 * invitations flow). It needs to:
 *   1. Validate the caller is planner/cohost.
 *   2. Upsert respondent rows (rsvp_status='invited', invited_by,
 *      invited_at).
 *   3. Skip recipients already on the trip (dupe check).
 *   4. Queue an SMS via the existing _sms-shared/dm-sender helpers
 *      (per BUILD_QUESTIONS Q5/Q7). Body uses personalize.ts tokens.
 *   5. Auto-post a system entry to the activity feed.
 *
 * Returning 501 here keeps the route shape documented + reserves
 * the URL so the UI work in Step 3-4 can call it speculatively.
 */

import { jsonErr } from "@/lib/http";

export async function POST() {
  return jsonErr(501, "not_implemented", "Invitations send lands in build guide §6 Step 6.");
}
