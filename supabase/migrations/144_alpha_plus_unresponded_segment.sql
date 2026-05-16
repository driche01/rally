-- ============================================================
-- Migration 144: Alpha+ — widen planner_blasts.recipient_segment
--
-- Per Q34 (RESOLVED 2026-05-14): the new "unresponded" segment
-- (invited + maybe combined) needs to be a valid recipient_segment
-- so planner_blasts can record it with the same fidelity as the
-- existing four. Otherwise the audit trail loses precision when
-- the planner sends to the unresponded set.
--
-- All existing values stay valid. Drop + re-add the CHECK with
-- the new entry included.
-- ============================================================

ALTER TABLE planner_blasts
  DROP CONSTRAINT IF EXISTS planner_blasts_segment_check;

ALTER TABLE planner_blasts
  ADD CONSTRAINT planner_blasts_segment_check
  CHECK (recipient_segment IN ('going','maybe','invited','all','unresponded'));

INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES ('144', 'alpha_plus_unresponded_segment', ARRAY[]::text[])
ON CONFLICT (version) DO NOTHING;
