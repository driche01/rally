-- Add optional destination field to trips so planners can record a known
-- destination upfront (rather than always deciding via a poll).
ALTER TABLE trips
  ADD COLUMN IF NOT EXISTS destination text;
