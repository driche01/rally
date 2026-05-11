-- ============================================================
-- Migration 119: Phase A — trip_cohosts join table
--
-- Per BUILD_QUESTIONS.md Q3 (RESOLVED): new table for cohosts,
-- separate from trip_members (which the Expo app's authed-only
-- dashboard uses). Cohosts have full planner-equivalent
-- permissions on a trip.
--
-- FKs land on profiles(id) per Q1 (planner FKs → profiles) —
-- cohosts must have a Rally auth account before being granted.
-- ============================================================

CREATE TABLE IF NOT EXISTS trip_cohosts (
  trip_id    uuid        NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  user_id    uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  invited_by uuid                 REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (trip_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_trip_cohosts_user
  ON trip_cohosts (user_id);

ALTER TABLE trip_cohosts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='trip_cohosts' AND policyname='trip_cohosts_select'
  ) THEN
    CREATE POLICY trip_cohosts_select
      ON trip_cohosts FOR SELECT
      USING (
        user_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM trips t
          WHERE t.id = trip_cohosts.trip_id AND t.created_by = auth.uid()
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='trip_cohosts' AND policyname='trip_cohosts_insert'
  ) THEN
    CREATE POLICY trip_cohosts_insert
      ON trip_cohosts FOR INSERT
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM trips t
          WHERE t.id = trip_cohosts.trip_id AND t.created_by = auth.uid()
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='trip_cohosts' AND policyname='trip_cohosts_delete'
  ) THEN
    CREATE POLICY trip_cohosts_delete
      ON trip_cohosts FOR DELETE
      USING (
        user_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM trips t
          WHERE t.id = trip_cohosts.trip_id AND t.created_by = auth.uid()
        )
      );
  END IF;
END$$;

INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES ('119', 'phase_a_trip_cohosts', ARRAY[]::text[])
ON CONFLICT (version) DO NOTHING;
