-- ============================================================
-- Migration 145: Alpha+ — wider theme palette + new effect column
--
-- Per user directive 2026-05-14: expand the theme catalog (Partiful
-- inspired but Rally-unique) and add an "effect" concept that
-- renders an animated overlay on the trip page (sparkles, confetti,
-- petals, etc.).
--
-- Schema:
--   1. Widen trips.theme CHECK to include the new theme names.
--   2. Add trips.effect text NULL with a CHECK on the closed set
--      of supported effect names. NULL = no effect (default).
--
-- All additive.
-- ============================================================

-- 1. Wider theme set. Existing 6 preserved; 6 new added.
ALTER TABLE trips
  DROP CONSTRAINT IF EXISTS trips_theme_check;

ALTER TABLE trips
  ADD CONSTRAINT trips_theme_check
  CHECK (theme IS NULL OR theme = ANY (ARRAY[
    -- Existing (preserved)
    'classic'::text,
    'eclectic'::text,
    'fancy'::text,
    'literary'::text,
    'digital'::text,
    'elegant'::text,
    -- Light additions
    'mist'::text,
    'blossom'::text,
    'sage'::text,
    -- Dark additions
    'midnight'::text,
    'forest'::text,
    'noir'::text,
    -- Vibes additions
    'sunset'::text,
    'neon'::text,
    -- Seasonal additions
    'spring'::text,
    'summer'::text,
    'autumn'::text,
    'winter'::text
  ]));

-- 2. New effect column. NULL = no effect.
ALTER TABLE trips
  ADD COLUMN IF NOT EXISTS effect text NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_schema='public' AND constraint_name='trips_effect_check'
  ) THEN
    ALTER TABLE trips
      ADD CONSTRAINT trips_effect_check
      CHECK (effect IS NULL OR effect = ANY (ARRAY[
        'sparkles'::text,
        'confetti'::text,
        'hearts'::text,
        'snowflakes'::text,
        'bubbles'::text,
        'petals'::text,
        'embers'::text,
        'stars'::text
      ]));
  END IF;
END$$;

INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES ('145', 'alpha_plus_themes_and_effects', ARRAY[]::text[])
ON CONFLICT (version) DO NOTHING;
