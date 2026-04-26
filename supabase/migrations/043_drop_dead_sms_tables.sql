-- ============================================================
-- Migration 043: Drop dead SMS-side tables
--
-- All tables below were written exclusively by the conversational SMS
-- code that was retired in the Phase 5.6 kill-switch and deleted in
-- the post-pivot cleanup. None have any remaining writers or readers
-- in the live codebase (verified via grep across supabase/functions,
-- src/, and app/ before this migration was authored).
--
-- Idempotent — DROP TABLE IF EXISTS + DROP COLUMN IF EXISTS.
--
-- Tables retired:
--   scheduled_actions      ─ phase nudge cooldowns; sms-nudge-scheduler
--   outbound_message_queue ─ rate-limited send queue; twilio-sender
--   split_requests         ─ Venmo SPLIT flow; venmo-split-link.ts
--   propose_requests       ─ PROPOSE keyword flow; venmo-split-link.ts
--   booking_signals        ─ monetization instrumentation; phase-flow
--   user_preferences       ─ personalization; bot-response-generator
--   trip_session_events    ─ phase transition log; phase-flow
--   trip_access_tokens     ─ legacy /trip/[id] public view; trip-view fn
--
-- Plus the phase_confirmation column on trip_session_participants
-- (added in migration 030 for prefill confirmation flow; no readers).
--
-- The shared-table corner cases:
--   trip_session_events had RLS policies added in migration 041; those
--   are dropped automatically by DROP TABLE CASCADE.
-- ============================================================

DROP TABLE IF EXISTS scheduled_actions      CASCADE;
DROP TABLE IF EXISTS outbound_message_queue CASCADE;
DROP TABLE IF EXISTS split_requests         CASCADE;
DROP TABLE IF EXISTS propose_requests       CASCADE;
DROP TABLE IF EXISTS booking_signals        CASCADE;
DROP TABLE IF EXISTS user_preferences       CASCADE;
DROP TABLE IF EXISTS trip_session_events    CASCADE;
DROP TABLE IF EXISTS trip_access_tokens     CASCADE;

-- ─── Drop the dead column on trip_session_participants ─────────────────────
ALTER TABLE trip_session_participants
  DROP COLUMN IF EXISTS phase_confirmation;
