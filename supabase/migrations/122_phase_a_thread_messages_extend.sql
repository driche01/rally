-- ============================================================
-- Migration 122: Phase A — extend thread_messages for invitation rail
--
-- Per BUILD_QUESTIONS.md Q5 (RESOLVED, revised): instead of a
-- new sms_messages table, Phase A reuses thread_messages — the
-- existing outbound SMS send log used by _sms-shared/dm-sender.ts
-- (sendDm + broadcast). thread_messages already carries body,
-- message_sid, delivery_status, error_code, direction,
-- sender_phone.
--
-- We add additively:
--   1. trip_id — nullable FK to trips, so Phase A sends bind to
--      a trip without needing the legacy trip_session_id (which
--      is poll-cadence-specific). Legacy sends keep using
--      trip_session_id; Phase A uses trip_id.
--   2. message_type — nullable text, distinguishes 'rsvp_nudge'
--      etc. from legacy outbound send types in reports.
--   3. Two indexes for the planner activity-log read path and
--      the RSVP-nudge scheduler dedupe check.
-- ============================================================

ALTER TABLE thread_messages
  ADD COLUMN IF NOT EXISTS trip_id      uuid REFERENCES trips(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS message_type text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'thread_messages_message_type_check'
  ) THEN
    ALTER TABLE thread_messages
      ADD CONSTRAINT thread_messages_message_type_check
      CHECK (
        message_type IS NULL OR message_type IN (
          'rsvp_nudge',
          'profile_completion',
          'booking_nudge',
          'pre_trip_summary',
          'planner_blast'
        )
      );
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_thread_messages_trip_type_created
  ON thread_messages (trip_id, message_type, created_at DESC)
  WHERE direction = 'outbound';

CREATE INDEX IF NOT EXISTS idx_thread_messages_rsvp_nudge_dedupe
  ON thread_messages (trip_id, sender_phone, created_at DESC)
  WHERE direction = 'outbound' AND message_type = 'rsvp_nudge';

INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES ('122', 'phase_a_thread_messages_extend', ARRAY[]::text[])
ON CONFLICT (version) DO NOTHING;
