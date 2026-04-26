-- ============================================================
-- Migration 041: Activity timeline RLS
--
-- Phase 4.5 of the 1:1 SMS pivot. Opens narrowly-scoped read access
-- for the Group Dashboard's activity feed:
--   - trip_session_events: trip members can read all events (phase
--     transitions, etc.). Same gating as migration 040.
--   - thread_messages: trip members can read ONLY the broadcast rows
--     (sender_role='planner_broadcast' AND thread_id LIKE 'broadcast_%').
--     Each participant's 1:1 thread stays private — friends shouldn't
--     see each other's personal replies, and the planner shouldn't
--     either. Group-level broadcasts ARE inherently visible to the
--     group, so reading them is fine.
--
-- Idempotent.
-- ============================================================


-- ─── 1. trip_session_events: trip members can read ─────────────────────────
DO $$ BEGIN
  CREATE POLICY "trip_session_events_member_read" ON trip_session_events
    FOR SELECT TO authenticated USING (
      EXISTS (
        SELECT 1 FROM trip_sessions ts
        JOIN trip_members tm ON tm.trip_id = ts.trip_id
        WHERE ts.id = trip_session_events.trip_session_id
          AND tm.user_id = auth.uid()
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ─── 2. thread_messages: trip members can read ONLY broadcast rows ─────────
-- Per-participant 1:1 thread content stays locked. Only the planner's
-- broadcast log (thread_id like 'broadcast_<sessionId>', sender_role
-- 'planner_broadcast') is exposed.
DO $$ BEGIN
  CREATE POLICY "thread_messages_member_broadcast_read" ON thread_messages
    FOR SELECT TO authenticated USING (
      sender_role = 'planner_broadcast'
      AND thread_id LIKE 'broadcast_%'
      AND EXISTS (
        SELECT 1 FROM trip_sessions ts
        JOIN trip_members tm ON tm.trip_id = ts.trip_id
        WHERE ts.id = thread_messages.trip_session_id
          AND tm.user_id = auth.uid()
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
