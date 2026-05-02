-- Migration 112: Decline reason on respondents
--
-- When a respondent taps "Sorry, can't make it" on the public respond
-- screen, they get an optional free-text follow-up. The reason lands
-- here so the planner can see context next to the DECLINED pill in the
-- Group section (e.g. "I'm out for a wedding that weekend").
--
-- Always nullable — the prompt is opt-in and the no-path still works
-- when the respondent skips. Length-capped at 280 to keep the planner UI
-- readable and to discourage essays we'd then need to truncate.

ALTER TABLE respondents
  ADD COLUMN IF NOT EXISTS decline_reason text
    CHECK (decline_reason IS NULL OR char_length(decline_reason) <= 280);
