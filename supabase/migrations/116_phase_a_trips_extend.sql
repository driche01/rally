-- ============================================================
-- Migration 116: Phase A — extend trips with invitation-page fields
--
-- Adds Partiful-style invitation page metadata to trips. All
-- additive; existing columns and constraints are untouched.
--
-- Decisions: BUILD_QUESTIONS.md Q1 (planner FK target). All
-- existing FKs on trips already point at profiles(id) — this
-- migration adds no new FKs.
-- ============================================================

ALTER TABLE trips
  ADD COLUMN IF NOT EXISTS theme            text,
  ADD COLUMN IF NOT EXISTS cover_image_url  text,
  ADD COLUMN IF NOT EXISTS description      text,
  ADD COLUMN IF NOT EXISTS is_public        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS budget_min       numeric,
  ADD COLUMN IF NOT EXISTS budget_max       numeric;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'trips_theme_check'
  ) THEN
    ALTER TABLE trips
      ADD CONSTRAINT trips_theme_check
      CHECK (theme IS NULL OR theme IN (
        'classic','eclectic','fancy','literary','digital','elegant'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'trips_budget_range_check'
  ) THEN
    ALTER TABLE trips
      ADD CONSTRAINT trips_budget_range_check
      CHECK (
        budget_min IS NULL OR budget_max IS NULL OR budget_min <= budget_max
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'trips_cover_image_url_len'
  ) THEN
    ALTER TABLE trips
      ADD CONSTRAINT trips_cover_image_url_len
      CHECK (cover_image_url IS NULL OR char_length(cover_image_url) <= 2048);
  END IF;
END$$;

-- Self-register so supabase_migrations.schema_migrations stays in
-- sync when this migration is applied via `supabase db query`
-- rather than `db push`. Safe to re-run.
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES ('116', 'phase_a_trips_extend', ARRAY[]::text[])
ON CONFLICT (version) DO NOTHING;
