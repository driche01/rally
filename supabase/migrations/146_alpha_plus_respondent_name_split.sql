-- ============================================================
-- Migration 146: split respondent name into first / last
--
-- The RSVP flow now asks for first + last name as two fields so
-- we can carry "real" identity across trips (and into the user's
-- own Rally account when they later sign in via SMS).
--
-- Additive only — keep the existing `name` column untouched so
-- the mobile app and every existing planner-side query keep
-- working. We backfill first_name / last_name from `name` by
-- splitting on the first whitespace; anything past the first
-- token becomes last_name. Single-word names land in first_name
-- with last_name=NULL.
--
-- Why on respondents (not just on profiles): the public RSVP
-- flow inserts a respondents row before there's a profile or a
-- users row. We need to capture both parts at that moment.
-- ============================================================

ALTER TABLE respondents
  ADD COLUMN IF NOT EXISTS first_name text,
  ADD COLUMN IF NOT EXISTS last_name  text;

-- Backfill — split on the first whitespace run.
UPDATE respondents
SET
  first_name = COALESCE(
    first_name,
    NULLIF(split_part(trim(name), ' ', 1), '')
  ),
  last_name = COALESCE(
    last_name,
    NULLIF(
      trim(
        regexp_replace(trim(name), '^\S+\s*', '')
      ),
      ''
    )
  )
WHERE name IS NOT NULL
  AND (first_name IS NULL OR last_name IS NULL);

-- Same pair of columns on traveler_profiles so the cross-trip
-- profile cache can hold them too. The phone-keyed upsert in the
-- RSVP route writes both.
ALTER TABLE traveler_profiles
  ADD COLUMN IF NOT EXISTS first_name text,
  ADD COLUMN IF NOT EXISTS last_name  text;

INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES ('146', 'alpha_plus_respondent_name_split', ARRAY[]::text[])
ON CONFLICT (version) DO NOTHING;
