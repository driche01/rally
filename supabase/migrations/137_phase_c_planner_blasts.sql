-- ============================================================
-- Migration 137: Phase C — planner_blasts
--
-- One row per composed blast. composed_by → profiles(id) (Q20).
-- activity_feed_entry_id is set after the blast successfully
-- auto-posts to the feed (build guide §5).
--
-- recipient_segment CHECK matches the four valid segments in the
-- blast composer UI.
-- ============================================================

CREATE TABLE IF NOT EXISTS planner_blasts (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id                  uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  composed_by              uuid NOT NULL REFERENCES profiles(id),
  recipient_segment        text NOT NULL,
  message_body             text NOT NULL,
  include_planner          boolean NOT NULL DEFAULT false,
  recipient_count          integer NOT NULL DEFAULT 0,
  sent_count               integer NOT NULL DEFAULT 0,
  failed_count             integer NOT NULL DEFAULT 0,
  suppressed_opted_out     integer NOT NULL DEFAULT 0,
  scheduled_for            timestamptz NULL,
  sent_at                  timestamptz NULL,
  auto_posted_to_feed      boolean NOT NULL DEFAULT true,
  activity_feed_entry_id   uuid NULL REFERENCES activity_feed_entries(id) ON DELETE SET NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT planner_blasts_segment_check
    CHECK (recipient_segment IN ('going','maybe','invited','all')),
  CONSTRAINT planner_blasts_body_length
    CHECK (char_length(message_body) BETWEEN 1 AND 1600)
);

-- Composer history view + rate-limit math hot path.
CREATE INDEX IF NOT EXISTS idx_planner_blasts_trip_sent
  ON planner_blasts (trip_id, sent_at DESC);

-- Rate-limit math secondary path (7-day window across all of a trip's blasts).
CREATE INDEX IF NOT EXISTS idx_planner_blasts_trip_created
  ON planner_blasts (trip_id, created_at DESC);

ALTER TABLE planner_blasts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='planner_blasts' AND policyname='blasts_host_select') THEN
    CREATE POLICY blasts_host_select ON planner_blasts FOR SELECT
      USING (
        EXISTS (SELECT 1 FROM trips t WHERE t.id = planner_blasts.trip_id AND t.created_by = auth.uid())
        OR EXISTS (SELECT 1 FROM trip_cohosts c WHERE c.trip_id = planner_blasts.trip_id AND c.user_id = auth.uid())
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='planner_blasts' AND policyname='blasts_host_insert') THEN
    CREATE POLICY blasts_host_insert ON planner_blasts FOR INSERT
      WITH CHECK (
        composed_by = auth.uid()
        AND (
          EXISTS (SELECT 1 FROM trips t WHERE t.id = planner_blasts.trip_id AND t.created_by = auth.uid())
          OR EXISTS (SELECT 1 FROM trip_cohosts c WHERE c.trip_id = planner_blasts.trip_id AND c.user_id = auth.uid())
        )
      );
  END IF;
END$$;

INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES ('137', 'phase_c_planner_blasts', ARRAY[]::text[])
ON CONFLICT (version) DO NOTHING;
