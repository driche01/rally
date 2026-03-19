-- Add trip_duration field to store the planner's target trip length.
-- This is set directly on the trip (creation/edit form) and also auto-filled
-- when a duration poll (dates-type, non-date-range options) is decided.

alter table public.trips
  add column if not exists trip_duration text;
