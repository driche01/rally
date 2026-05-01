-- ============================================================
-- Migration 088: Remove planner inbox
--
-- Phase 15 retires the planner inbox feature. Rally no longer relays
-- member-to-planner SMS into a planner-side inbox; planners reach out
-- to members directly. The "I'll pass this along to {planner}" copy
-- in the redirect SMS becomes a "Rally doesn't relay messages" nudge
-- (handled in the inbound-processor edge function — not this migration).
--
-- See `~/.claude/projects/-Users-davidriche-Rally/memory/project_planner_inbox_removed.md`
-- for the architectural decision.
--
-- Drops the inbox columns + index added by 045_planner_inbox.sql, plus
-- the two ack RPCs. Keeps `resolve_inbound_for_planner` — it's still
-- used to tag inbound rows with `trip_session_id` for diagnostics +
-- threading, even without the inbox.
--
-- Idempotent.
-- ============================================================


-- ─── 1. Drop ack RPCs ────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS ack_planner_inbox_message(uuid);
DROP FUNCTION IF EXISTS ack_planner_inbox_for_trip(uuid);


-- ─── 2. Drop inbox index ─────────────────────────────────────────────────────

DROP INDEX IF EXISTS idx_thread_messages_inbox_per_session;


-- ─── 3. Drop inbox columns on thread_messages ────────────────────────────────
-- The "needs planner attention" flag and the ack pair are now dead. Inbound
-- thread_messages rows still record what the member sent (for support
-- diagnostics + the auto-redirect log), but no surface reads these columns.

ALTER TABLE thread_messages
  DROP COLUMN IF EXISTS needs_planner_attention,
  DROP COLUMN IF EXISTS planner_acknowledged_at,
  DROP COLUMN IF EXISTS planner_acknowledged_by;
