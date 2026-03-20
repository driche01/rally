-- Add RSVP status and preference responses to respondents table.
-- rsvp: 'in' | 'out' — whether the group member confirmed attendance.
-- preferences: JSON blob storing their answers to the 3 preference questions.

ALTER TABLE respondents
  ADD COLUMN IF NOT EXISTS rsvp text CHECK (rsvp IN ('in', 'out')),
  ADD COLUMN IF NOT EXISTS preferences jsonb;
