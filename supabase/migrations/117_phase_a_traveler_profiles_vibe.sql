-- ============================================================
-- Migration 117: Phase A — vibe questions on traveler_profiles
--
-- Per BUILD_QUESTIONS.md Q2 (RESOLVED): one profile per phone,
-- shared between the Expo app and the Phase A web app. We add
-- vibe columns additively; existing columns stay untouched.
-- The Phase A capture flow writes the new columns; the Expo app
-- continues writing the older sleep_pref / lodging_pref / etc.
--
-- vibe_captured_at distinguishes "row exists from Expo path but
-- vibe never captured" from "row fully completed by Phase A."
-- Used by the RSVP gate to decide whether to show capture or
-- one-tap confirm on returning users.
-- ============================================================

ALTER TABLE traveler_profiles
  ADD COLUMN IF NOT EXISTS vibe_beach_or_mountain     text,
  ADD COLUMN IF NOT EXISTS vibe_spa_or_hike           text,
  ADD COLUMN IF NOT EXISTS vibe_foodie_or_casual      text,
  ADD COLUMN IF NOT EXISTS vibe_social_or_chill       text,
  ADD COLUMN IF NOT EXISTS vibe_culture_or_relaxation text,
  ADD COLUMN IF NOT EXISTS budget_comfort             text,
  ADD COLUMN IF NOT EXISTS vibe_captured_at           timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.check_constraints WHERE constraint_name = 'traveler_profiles_vibe_beach_or_mountain_check') THEN
    ALTER TABLE traveler_profiles ADD CONSTRAINT traveler_profiles_vibe_beach_or_mountain_check
      CHECK (vibe_beach_or_mountain IS NULL OR vibe_beach_or_mountain IN ('beach','mountain','both'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.check_constraints WHERE constraint_name = 'traveler_profiles_vibe_spa_or_hike_check') THEN
    ALTER TABLE traveler_profiles ADD CONSTRAINT traveler_profiles_vibe_spa_or_hike_check
      CHECK (vibe_spa_or_hike IS NULL OR vibe_spa_or_hike IN ('spa','hike','both'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.check_constraints WHERE constraint_name = 'traveler_profiles_vibe_foodie_or_casual_check') THEN
    ALTER TABLE traveler_profiles ADD CONSTRAINT traveler_profiles_vibe_foodie_or_casual_check
      CHECK (vibe_foodie_or_casual IS NULL OR vibe_foodie_or_casual IN ('foodie','casual','both'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.check_constraints WHERE constraint_name = 'traveler_profiles_vibe_social_or_chill_check') THEN
    ALTER TABLE traveler_profiles ADD CONSTRAINT traveler_profiles_vibe_social_or_chill_check
      CHECK (vibe_social_or_chill IS NULL OR vibe_social_or_chill IN ('social','chill','both'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.check_constraints WHERE constraint_name = 'traveler_profiles_vibe_culture_or_relaxation_check') THEN
    ALTER TABLE traveler_profiles ADD CONSTRAINT traveler_profiles_vibe_culture_or_relaxation_check
      CHECK (vibe_culture_or_relaxation IS NULL OR vibe_culture_or_relaxation IN ('culture','relaxation','both'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.check_constraints WHERE constraint_name = 'traveler_profiles_budget_comfort_check') THEN
    ALTER TABLE traveler_profiles ADD CONSTRAINT traveler_profiles_budget_comfort_check
      CHECK (budget_comfort IS NULL OR budget_comfort IN ('budget','mid','premium','luxury'));
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_traveler_profiles_needs_vibe_capture
  ON traveler_profiles (phone)
  WHERE vibe_captured_at IS NULL;

INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES ('117', 'phase_a_traveler_profiles_vibe', ARRAY[]::text[])
ON CONFLICT (version) DO NOTHING;
