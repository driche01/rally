-- ============================================================
-- Migration 126: Phase B — extend itinerary_blocks for AI gen + voting
--
-- Per BUILD_QUESTIONS.md Q11 + Q13 (RESOLVED): extend additively,
-- keep day_date (don't add day_number), FK created_by to
-- respondents(id) (per the Phase B FK target rule for per-member
-- columns).
--
-- The existing Expo-era itinerary_blocks has 73 live rows. The CHECK
-- constraint we add covers both the Expo set (accommodation, activity,
-- free_time, meal, travel — verified by SELECT DISTINCT pre-migration)
-- AND Phase B's canonical set (activity, meal, transit, lodging,
-- free_time, other). Both flows coexist.
-- ============================================================

ALTER TABLE itinerary_blocks
  ADD COLUMN IF NOT EXISTS ai_generated  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS created_by    uuid REFERENCES respondents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS location_url  text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'itinerary_blocks_type_check'
  ) THEN
    ALTER TABLE itinerary_blocks
      ADD CONSTRAINT itinerary_blocks_type_check
      CHECK (type IN (
        'activity', 'meal', 'free_time', 'other',
        'accommodation', 'lodging',
        'transit', 'travel'
      ));
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_itinerary_blocks_trip_day_start
  ON itinerary_blocks (trip_id, day_date, start_time);

CREATE INDEX IF NOT EXISTS idx_itinerary_blocks_ai_generated
  ON itinerary_blocks (trip_id) WHERE ai_generated = true;

INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES ('126', 'phase_b_itinerary_blocks_extend', ARRAY[]::text[])
ON CONFLICT (version) DO NOTHING;
