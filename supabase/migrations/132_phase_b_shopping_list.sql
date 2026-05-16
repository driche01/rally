-- ============================================================
-- Migration 132: Phase B — auto-aggregated shopping list
--
-- Derived from meal_ingredients. Phase B initial ship keeps the
-- aggregation logic in app-code (server route handler triggered
-- on meal save). If that path proves unreliable, we promote to
-- a SQL trigger in a follow-up migration.
--
-- UNIQUE on (trip_id, lower(name), unit) — Phase B's wow feature
-- depends on this constraint to enforce dedup at the row level.
-- ============================================================

CREATE TABLE IF NOT EXISTS shopping_list_items (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id                uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  name                   text NOT NULL,
  total_quantity         numeric NOT NULL,
  unit                   text NOT NULL,
  category               text NOT NULL DEFAULT 'other',
  assigned_respondent_id uuid REFERENCES respondents(id) ON DELETE SET NULL,
  is_acquired            boolean NOT NULL DEFAULT false,
  source_meal_ids        uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shopping_list_category_check
    CHECK (category IN ('produce','meat_fish','dairy_fridge','pantry','other'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_shopping_list_unique_per_trip
  ON shopping_list_items (trip_id, lower(name), unit);

CREATE INDEX IF NOT EXISTS idx_shopping_list_trip_category
  ON shopping_list_items (trip_id, category, name);

ALTER TABLE shopping_list_items ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='shopping_list_items' AND policyname='sli_public_select') THEN
    CREATE POLICY sli_public_select ON shopping_list_items FOR SELECT
      USING (EXISTS (SELECT 1 FROM trips t WHERE t.id = shopping_list_items.trip_id));
  END IF;
END$$;

INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES ('132', 'phase_b_shopping_list', ARRAY[]::text[])
ON CONFLICT (version) DO NOTHING;
