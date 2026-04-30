-- ============================================================
-- Migration 058: Backfill poll titles to respondent-friendly framing
--
-- The four standard poll types had their stored titles refreshed in the
-- app code from first-person plural ("Where are we going?", etc.) to
-- second-person ("Where do you want to go?"). New polls created after
-- the change use the new strings, but existing polls still carry the
-- old titles in the DB — so respondents see the old framing on the
-- survey unless we backfill.
--
-- Idempotent: WHERE clauses match only the legacy strings, so this is
-- safe to re-run. Non-matching titles (e.g. custom polls authored by
-- planners) are left untouched.
-- ============================================================

UPDATE polls
SET    title = 'Where do you want to go?'
WHERE  type = 'destination'
  AND  title IN ('Where are we going?', 'Where are you going?');

UPDATE polls
SET    title = 'When are you free?'
WHERE  type = 'dates'
  AND  title IN ('When are we going?', 'When are you available?');

UPDATE polls
SET    title = 'How long should the trip be?'
WHERE  type = 'custom'
  AND  title IN ('How long are we going?', 'How long is the trip?');

UPDATE polls
SET    title = 'What''s your budget? (travel + lodging only)'
WHERE  type = 'budget'
  AND  title IN (
    'What''s our budget?',
    'What''s our budget? (travel + lodging only)',
    'What''s your budget?'
  );
