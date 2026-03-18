-- Add optional contact fields to respondents so the planner can see
-- each group member's email and phone number.

ALTER TABLE respondents
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS phone text;
