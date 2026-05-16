-- ============================================================
-- Migration 148: activity feed v2 — reactions + threaded replies
--
-- Backlog items #12 + #13: members can drop emoji reactions on
-- feed entries, reply in-thread to a post, and post GIFs / photos
-- via the existing entry_type set (already includes 'gif' +
-- 'photo' — no CHECK widening needed).
--
-- Additive only:
--   - new column   activity_feed_entries.parent_id (self-FK, ON DELETE CASCADE)
--   - new table    activity_reactions
--   - new indexes  for the (parent_id) feed query + reaction reads
--
-- RLS: reactions mirror the activity_feed_entries policy. Anon
-- SELECT is permitted under share-token reach (so the public
-- invite page can render counts), authenticated INSERT/DELETE
-- only for your own reactions.
-- ============================================================

ALTER TABLE activity_feed_entries
  ADD COLUMN IF NOT EXISTS parent_id uuid
    REFERENCES activity_feed_entries(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS activity_feed_entries_parent_idx
  ON activity_feed_entries(parent_id)
  WHERE parent_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS activity_reactions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id    uuid NOT NULL REFERENCES activity_feed_entries(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji       text NOT NULL CHECK (length(emoji) BETWEEN 1 AND 16),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entry_id, user_id, emoji)
);

CREATE INDEX IF NOT EXISTS activity_reactions_entry_idx
  ON activity_reactions(entry_id);

CREATE INDEX IF NOT EXISTS activity_reactions_user_idx
  ON activity_reactions(user_id);

ALTER TABLE activity_reactions ENABLE ROW LEVEL SECURITY;

-- Anon SELECT — same posture as activity_feed_entries (share-token
-- gated at the app layer; the policy itself is permissive since
-- the entries it references are already access-controlled).
DROP POLICY IF EXISTS "activity_reactions_select_all" ON activity_reactions;
CREATE POLICY "activity_reactions_select_all" ON activity_reactions
  FOR SELECT USING (true);

-- Authenticated INSERT — you can only react as yourself.
DROP POLICY IF EXISTS "activity_reactions_insert_self" ON activity_reactions;
CREATE POLICY "activity_reactions_insert_self" ON activity_reactions
  FOR INSERT
  WITH CHECK (user_id IN (SELECT id FROM users WHERE auth_user_id = auth.uid()));

-- Authenticated DELETE — you can only remove your own reactions.
DROP POLICY IF EXISTS "activity_reactions_delete_self" ON activity_reactions;
CREATE POLICY "activity_reactions_delete_self" ON activity_reactions
  FOR DELETE
  USING (user_id IN (SELECT id FROM users WHERE auth_user_id = auth.uid()));

-- Service-role bypasses RLS, used by the API for cookie-only
-- (session-token) writes after the soft-auth gate validates the
-- caller's identity.

INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES ('148', 'alpha_plus_activity_feed_v2', ARRAY[]::text[])
ON CONFLICT (version) DO NOTHING;
