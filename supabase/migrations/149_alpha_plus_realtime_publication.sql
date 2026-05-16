-- ============================================================
-- Migration 149: register the activity-feed tables in the
-- supabase_realtime publication so the browser-side feed picks up
-- INSERTs / UPDATEs / DELETEs without a poll.
--
-- The 148 migration created activity_reactions and added parent_id
-- to activity_feed_entries; this one wires both tables into the
-- realtime stream. Migration is split so 148 stays focused on
-- schema and this one is idempotent on schemaful clones (e.g.
-- preview / staging copies) that may inherit a different
-- publication state.
--
-- Idempotent: DROP-then-ADD inside a DO block guards against the
-- "publication already includes this table" error on re-run.
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'activity_feed_entries'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE activity_feed_entries';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'activity_reactions'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE activity_reactions';
  END IF;
END $$;

INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES ('149', 'alpha_plus_realtime_publication', ARRAY[]::text[])
ON CONFLICT (version) DO NOTHING;
