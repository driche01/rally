-- Phase 6.2 — stuck-trip planner alert
--
-- One-shot SMS to the planner when a trip is "stuck" — defined as:
--   1. Launched ≥ 5 days ago (uses trip_sessions.created_at as launch ref)
--   2. Fewer than 50% of attending non-planner participants have responded
--
-- The scheduler evaluates eligibility every tick. The new column below is
-- the idempotency guard so the planner is texted at most once per trip.

ALTER TABLE trips
  ADD COLUMN IF NOT EXISTS stuck_alert_sent_at TIMESTAMPTZ;

COMMENT ON COLUMN trips.stuck_alert_sent_at IS
  'When the one-shot stuck-trip alert SMS was sent to the planner. NULL = not yet sent. Set by sms-stuck-trip-alert edge function.';
