-- ============================================================
-- Migration 141: Alpha+ — rideshare self-signup
--
-- Per Q30-Q33 (RESOLVED 2026-05-14):
--   • Q30: maybe-status respondents can self-sign-up for a ride
--          (not just going).
--   • Q31: ride_notes is a NEW text column on travel_groupings,
--          distinct from the existing logistics `notes` field.
--   • Q32: the driver of a grouping can edit ride metadata
--          (in addition to the planner). Permission check happens
--          at the API layer.
--   • Q33: passenger's travel_arrangements is left untouched when
--          they join a ride — the grouping_members row is the
--          source of truth.
--
-- New columns:
--   travel_groupings.seats_total       — total seats including driver
--   travel_groupings.space_comfort     — tight | comfortable | spacious
--   travel_groupings.ride_notes        — driver's note to passengers
--                                         ("gas stop in Modesto", etc.)
--   travel_grouping_members.pre_assigned          — driver vouches
--   travel_grouping_members.added_by_respondent_id — audit trail
--
-- All additive. No DROPs / RENAMEs / NOT NULL toggles on existing.
-- ============================================================

ALTER TABLE travel_groupings
  ADD COLUMN IF NOT EXISTS seats_total   integer NULL,
  ADD COLUMN IF NOT EXISTS space_comfort text NULL,
  ADD COLUMN IF NOT EXISTS ride_notes    text NULL;

-- Closed-set CHECK on space_comfort. NULL allowed (driver hasn't
-- said yet). New constraint so we can drop+re-add for additions
-- without touching the prior shape.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_schema='public'
      AND constraint_name='travel_groupings_space_comfort_check'
  ) THEN
    ALTER TABLE travel_groupings
      ADD CONSTRAINT travel_groupings_space_comfort_check
      CHECK (space_comfort IS NULL OR space_comfort IN ('tight','comfortable','spacious'));
  END IF;
END$$;

ALTER TABLE travel_grouping_members
  ADD COLUMN IF NOT EXISTS pre_assigned             boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS added_by_respondent_id   uuid NULL REFERENCES respondents(id) ON DELETE SET NULL;

INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES ('141', 'alpha_plus_rideshare_signup', ARRAY[]::text[])
ON CONFLICT (version) DO NOTHING;
