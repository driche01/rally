-- ============================================================
-- Migration 121: Phase A — mutuals (past trip-mates graph)
--
-- Per BUILD_QUESTIONS.md Q1 (RESOLVED): mutuals FK users(id) —
-- the social graph is phone-keyed, not auth-keyed, so it
-- matches the existing users table's identity scope.
--
-- Stored as two rows per mutual pair (one row per direction) so
-- the planner-side "people I've traveled with" query is a single
-- index lookup. Populated by a service-role job that joins
-- respondents across trips post-RSVP — not user-edited.
-- ============================================================

CREATE TABLE IF NOT EXISTS mutuals (
  user_id                    uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mutual_user_id             uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shared_trip_count          integer     NOT NULL DEFAULT 0,
  last_traveled_together_at  timestamptz,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, mutual_user_id),
  CONSTRAINT mutuals_not_self CHECK (user_id <> mutual_user_id),
  CONSTRAINT mutuals_shared_trip_count_nonneg CHECK (shared_trip_count >= 0)
);

CREATE INDEX IF NOT EXISTS idx_mutuals_user_count_desc
  ON mutuals (user_id, shared_trip_count DESC);

ALTER TABLE mutuals ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='mutuals' AND policyname='mutuals_self_select'
  ) THEN
    CREATE POLICY mutuals_self_select
      ON mutuals FOR SELECT
      USING (
        user_id = (SELECT u.id FROM users u WHERE u.auth_user_id = auth.uid())
      );
  END IF;
END$$;

INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES ('121', 'phase_a_mutuals', ARRAY[]::text[])
ON CONFLICT (version) DO NOTHING;
