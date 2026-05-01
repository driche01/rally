-- ============================================================
-- Migration 089: Trip audit events (Phase 15 — activity log)
--
-- Replaces the dashboard's Members entry-card with an activity feed
-- backed by a single audit-event table. See
-- `~/.claude/projects/-Users-davidriche-Rally/memory/project_activity_log.md`
-- for the architectural decision.
--
-- This migration ships the schema + RLS only. Triggers (auto-emit for
-- joins / opt-outs / removals / profile updates / trip creation) and
-- app-code emit (per-field trip edits, poll lifecycle, survey
-- completion) land in follow-up migrations / app PRs.
--
-- Idempotent.
-- ============================================================


-- ─── 1. Table ────────────────────────────────────────────────────────────────
-- payload is jsonb so each event kind can carry its own shape without
-- schema churn (e.g. trip_field_changed needs old/new value pairs;
-- member_joined just needs participant_id + display_name). actor_id is
-- nullable because trigger-emitted events don't always have a clear
-- "who did this" actor at the row level.

CREATE TABLE IF NOT EXISTS trip_audit_events (
  id          bigserial PRIMARY KEY,
  trip_id     uuid        NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  actor_id    uuid        REFERENCES users(id) ON DELETE SET NULL,
  kind        text        NOT NULL,
  payload     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Hot path: latest events for a single trip's activity screen.
CREATE INDEX IF NOT EXISTS idx_trip_audit_events_trip_created
  ON trip_audit_events(trip_id, created_at DESC);


-- ─── 2. RLS ──────────────────────────────────────────────────────────────────
-- Planner-only read access (`role = 'planner'` on `trip_members`). No
-- INSERT/UPDATE/DELETE policy — writes go through service-role triggers
-- and SECURITY DEFINER RPCs only. The activity feed surface itself is
-- planner-only, but we enforce that at the data layer too so a leaked
-- non-planner token can't pull the feed.

ALTER TABLE trip_audit_events ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "trip_audit_events_planner_read" ON trip_audit_events
    FOR SELECT TO authenticated USING (
      EXISTS (
        SELECT 1 FROM trip_members tm
        WHERE tm.trip_id = trip_audit_events.trip_id
          AND tm.user_id = auth.uid()
          AND tm.role   = 'planner'
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
