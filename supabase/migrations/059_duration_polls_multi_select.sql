-- ============================================================
-- Migration 059: Backfill duration polls to multi-select
--
-- New duration polls (created after the form change) ship with
-- allow_multi_select=true so respondents can flag every length that
-- works for them. Existing duration polls in the DB were created with
-- allow_multi_select=false. Flip them to match the new behavior.
--
-- Match heuristic: type='custom' + title='How long should the trip be?'
-- (the canonical title set in app code + migration 058's backfill).
-- Custom polls authored manually with a different title are untouched.
-- Idempotent.
-- ============================================================

UPDATE polls
SET    allow_multi_select = true
WHERE  type = 'custom'
  AND  title = 'How long should the trip be?'
  AND  allow_multi_select = false;
