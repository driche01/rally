-- 150_alpha_trips_destination_place_id.sql
--
-- Add Google Places stable identifier to trips. Populated by the
-- web + mobile destination autocomplete on selection. Stable across
-- API revisions, so future "fetch place details" / "find nearest
-- airport" lookups can use it without re-geocoding.
--
-- Additive only (CLAUDE.md rule #1). Existing rows get NULL.
-- Idempotent via IF NOT EXISTS — safe to re-run.
--
-- Plan: SCHEMA_PLAN.md 2026-05-18 addendum
-- Applied to prod: 2026-05-18 (this file mirrors what ran in prod
-- via the Supabase SQL editor).

BEGIN;

ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS destination_place_id text NULL;

COMMENT ON COLUMN public.trips.destination_place_id IS
  'Google Places stable place_id for the trip destination. Set by '
  'the web + mobile autocomplete on selection. NULL = freeform '
  'destination never reconciled to a Google Place (legacy rows + '
  'manual edits).';

COMMIT;
