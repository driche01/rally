-- ============================================================
-- Migration 125: Phase B — extend lodging_options for AI suggestions + room layout
--
-- Per BUILD_QUESTIONS.md Q10 (RESOLVED): extend additively rather
-- than create a parallel Phase-B table. The existing Expo-era
-- lodging_options has 0 live rows (verified pre-migration), so the
-- CHECK widening is a no-op against live data.
-- ============================================================

ALTER TABLE lodging_options
  ADD COLUMN IF NOT EXISTS room_layout   jsonb,
  ADD COLUMN IF NOT EXISTS ai_suggested  boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  -- Widen the status CHECK so Phase B can mark a row as 'selected'
  -- (= the chosen lodging option for the trip). Verified 0 live rows
  -- pre-migration; existing 'option' default is preserved as a valid
  -- value in the wider set.
  IF EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'lodging_options_status_check'
  ) THEN
    ALTER TABLE lodging_options DROP CONSTRAINT lodging_options_status_check;
  END IF;
  ALTER TABLE lodging_options
    ADD CONSTRAINT lodging_options_status_check
    CHECK (status IN ('option', 'selected', 'rejected', 'booked'));
END$$;

CREATE INDEX IF NOT EXISTS idx_lodging_options_trip_status
  ON lodging_options (trip_id, status);

INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES ('125', 'phase_b_lodging_options_extend', ARRAY[]::text[])
ON CONFLICT (version) DO NOTHING;
