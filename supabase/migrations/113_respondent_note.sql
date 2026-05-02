-- Migration 113: Respondent note (replaces decline_reason)
--
-- The optional free-text field is no longer constrained to "why I'm
-- declining" — respondents now leave a note alongside either yes or no
-- on the RSVP screen. Renaming `decline_reason` to `note` keeps the
-- semantic honest (a YES note isn't a "decline reason").
--
-- Migration 112 only just shipped, so any data in decline_reason is
-- still copied across before the column is dropped — defensive even
-- though the production volume is effectively zero.

ALTER TABLE respondents
  ADD COLUMN IF NOT EXISTS note text
    CHECK (note IS NULL OR char_length(note) <= 280);

UPDATE respondents
  SET note = decline_reason
  WHERE note IS NULL AND decline_reason IS NOT NULL;

ALTER TABLE respondents
  DROP COLUMN IF EXISTS decline_reason;
