-- Phase 3: trip metadata fields
ALTER TABLE trips ADD COLUMN IF NOT EXISTS trip_type text;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS budget_per_person text;
