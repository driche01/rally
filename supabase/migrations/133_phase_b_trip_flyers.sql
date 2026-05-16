-- ============================================================
-- Migration 133: Phase B — Generate Flyer records
--
-- Each row is one rendered flyer. Phase B Step 3 renders 1080x1920
-- (Instagram story) + 1080x1080 (Instagram post) from one template;
-- stored as two rows (one per format).
--
-- rendered_image_url points at the trip-covers public bucket (the
-- one Phase A created). A future migration could split flyers into
-- their own bucket if scope demands.
--
-- generated_by FKs profiles(id) — flyers are planner/cohost actions,
-- they're authed (per Q13's exception for non-per-member columns).
-- ============================================================

CREATE TABLE IF NOT EXISTS trip_flyers (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id             uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  template_id         text NOT NULL,
  cover_image_url     text,
  rendered_image_url  text NOT NULL,
  format              text NOT NULL DEFAULT 'story',
  generated_by        uuid REFERENCES profiles(id) ON DELETE SET NULL,
  generated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trip_flyers_format_check CHECK (format IN ('story','post'))
);

CREATE INDEX IF NOT EXISTS idx_trip_flyers_trip_generated
  ON trip_flyers (trip_id, generated_at DESC);

ALTER TABLE trip_flyers ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='trip_flyers' AND policyname='flyers_public_select') THEN
    CREATE POLICY flyers_public_select ON trip_flyers FOR SELECT
      USING (EXISTS (SELECT 1 FROM trips t WHERE t.id = trip_flyers.trip_id));
  END IF;
END$$;

INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES ('133', 'phase_b_trip_flyers', ARRAY[]::text[])
ON CONFLICT (version) DO NOTHING;
