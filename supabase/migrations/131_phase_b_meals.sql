-- ============================================================
-- Migration 131: Phase B — meals + ingredients + voting
--
-- Per Q17 (RESOLVED): meal_ingredients are written in normalized
-- form at meal-plan generation time. Shopping list aggregation
-- downstream is a simple sum-by-name-and-unit.
--
-- assigned_cook_respondent_ids is a uuid[] to support shared cook
-- duties without a separate join table. FK is implicit (no row-
-- level FK enforcement on uuid[]); the API layer validates that
-- each id is a respondent for this trip.
-- ============================================================

CREATE TABLE IF NOT EXISTS meals (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id                       uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  day_date                      date NOT NULL,
  meal_type                     text NOT NULL,
  mode                          text NOT NULL DEFAULT 'tbd',
  recipe_name                   text,
  restaurant_name               text,
  restaurant_url                text,
  assigned_cook_respondent_ids  uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  notes                         text,
  ai_suggested                  boolean NOT NULL DEFAULT false,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT meals_meal_type_check
    CHECK (meal_type IN ('breakfast','lunch','dinner','snack')),
  CONSTRAINT meals_mode_check
    CHECK (mode IN ('cook_in','restaurant','tbd'))
);

CREATE INDEX IF NOT EXISTS idx_meals_trip_day_type
  ON meals (trip_id, day_date, meal_type);

CREATE TABLE IF NOT EXISTS meal_ingredients (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meal_id   uuid NOT NULL REFERENCES meals(id) ON DELETE CASCADE,
  name      text NOT NULL,
  quantity  numeric NOT NULL DEFAULT 1,
  unit      text NOT NULL DEFAULT 'unit',
  category  text NOT NULL DEFAULT 'other',
  CONSTRAINT meal_ingredients_category_check
    CHECK (category IN ('produce','meat_fish','dairy_fridge','pantry','other'))
);

CREATE INDEX IF NOT EXISTS idx_meal_ingredients_meal
  ON meal_ingredients (meal_id);
CREATE INDEX IF NOT EXISTS idx_meal_ingredients_name_unit
  ON meal_ingredients (lower(name), unit);

CREATE TABLE IF NOT EXISTS meal_votes (
  meal_id        uuid NOT NULL REFERENCES meals(id) ON DELETE CASCADE,
  respondent_id  uuid NOT NULL REFERENCES respondents(id) ON DELETE CASCADE,
  vote           text NOT NULL,
  voted_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (meal_id, respondent_id),
  CONSTRAINT meal_votes_vote_check CHECK (vote IN ('yes','no','maybe'))
);

ALTER TABLE meals             ENABLE ROW LEVEL SECURITY;
ALTER TABLE meal_ingredients  ENABLE ROW LEVEL SECURITY;
ALTER TABLE meal_votes        ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='meals' AND policyname='meals_public_select') THEN
    CREATE POLICY meals_public_select ON meals FOR SELECT
      USING (EXISTS (SELECT 1 FROM trips t WHERE t.id = meals.trip_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='meal_ingredients' AND policyname='mi_public_select') THEN
    CREATE POLICY mi_public_select ON meal_ingredients FOR SELECT
      USING (EXISTS (SELECT 1 FROM meals m WHERE m.id = meal_ingredients.meal_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='meal_votes' AND policyname='mv_public_select') THEN
    CREATE POLICY mv_public_select ON meal_votes FOR SELECT
      USING (EXISTS (SELECT 1 FROM meals m WHERE m.id = meal_votes.meal_id));
  END IF;
END$$;

INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES ('131', 'phase_b_meals', ARRAY[]::text[])
ON CONFLICT (version) DO NOTHING;
