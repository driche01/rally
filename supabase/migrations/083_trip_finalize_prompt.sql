-- Phase 1 of the trip-finalize flow.
--
-- When all group members have responded to every undecided poll OR the
-- book_by_date passes, Rally texts the planner a deep link asking them
-- to review the group's input and lock the trip. This column is the
-- idempotency guard so the planner is texted at most once per trip.

ALTER TABLE trips
  ADD COLUMN IF NOT EXISTS finalize_prompt_sent_at timestamptz;

COMMENT ON COLUMN trips.finalize_prompt_sent_at IS
  'Stamped once when sms-trip-finalize-prompt has texted the planner that the trip is ready to lock. Prevents re-prompting on every scheduler tick.';
