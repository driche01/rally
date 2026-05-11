-- ============================================================
-- Migration 120: Phase A — public-facing activity feed entries
--
-- Per BUILD_QUESTIONS.md Q4 (RESOLVED): new table, distinct from
-- trip_audit_events (planner-only audit log). This is the
-- invitee-facing social feed on the invitation page (RSVP
-- updates, comments, GIFs, system entries).
--
-- user_id FKs users(id) per Q1 (invitee FK target). Anyone with
-- the trip's share token can SELECT (anon is allowed on trips
-- via share-token policy; we mirror that here so the feed is
-- visible to the same audience). Authenticated members /
-- planners / cohosts can INSERT comments/gifs/photos.
-- System and rsvp_update entries are inserted by triggers
-- running with elevated rights (no public INSERT policy for
-- those entry types).
-- ============================================================

CREATE TABLE IF NOT EXISTS activity_feed_entries (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id     uuid        NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  user_id     uuid                 REFERENCES users(id) ON DELETE SET NULL,
  entry_type  text        NOT NULL,
  content     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT activity_feed_entries_entry_type_check
    CHECK (entry_type IN ('rsvp_update','comment','gif','photo','system','planner_post'))
);

CREATE INDEX IF NOT EXISTS idx_activity_feed_entries_trip_created
  ON activity_feed_entries (trip_id, created_at DESC);

ALTER TABLE activity_feed_entries ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='activity_feed_entries' AND policyname='activity_feed_entries_anon_select'
  ) THEN
    CREATE POLICY activity_feed_entries_anon_select
      ON activity_feed_entries FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM trips t WHERE t.id = activity_feed_entries.trip_id
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='activity_feed_entries' AND policyname='activity_feed_entries_member_insert'
  ) THEN
    CREATE POLICY activity_feed_entries_member_insert
      ON activity_feed_entries FOR INSERT
      WITH CHECK (
        entry_type IN ('comment','gif','photo','planner_post')
        AND (
          EXISTS (
            SELECT 1 FROM trips t
            WHERE t.id = activity_feed_entries.trip_id AND t.created_by = auth.uid()
          )
          OR EXISTS (
            SELECT 1 FROM trip_cohosts c
            WHERE c.trip_id = activity_feed_entries.trip_id AND c.user_id = auth.uid()
          )
          OR auth_user_is_trip_member(activity_feed_entries.trip_id)
        )
      );
  END IF;
END$$;

INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES ('120', 'phase_a_activity_feed_entries', ARRAY[]::text[])
ON CONFLICT (version) DO NOTHING;
