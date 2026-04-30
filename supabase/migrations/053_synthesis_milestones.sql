-- ============================================================
-- Migration 053: Synthesis milestone tracking
--
-- Synthesis SMS are informational fan-outs sent to the whole group
-- (not just non-responders) at three thresholds:
--   - 50% responded
--   - 100% responded
--   - 24h before responses_due with incomplete responses
--
-- These are distinct from cadence nudges (which are per-participant
-- and only target non-responders). To avoid sending the same milestone
-- twice, we track the last sent milestone per session.
--
-- The scheduler reads/writes these columns each tick.
-- ============================================================

ALTER TABLE trip_sessions
  ADD COLUMN IF NOT EXISTS last_synth_milestone text,
    -- nullable; values: 'half', 'full', 'pre_due'
  ADD COLUMN IF NOT EXISTS last_synth_sent_at   timestamptz;
