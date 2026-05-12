# Schema Plan — Phase B

**Generated:** 2026-05-12
**Reads from:** `SCHEMA_REPORT.md` + `docs/rally_phase_b_build_guide.md` §3 + `BUILD_QUESTIONS.md` Q10–Q17
**Status:** Q10–Q17 RESOLVED 2026-05-12. **All DDL below is preview only — nothing has been executed.** Migrations land only after human sign-off on this file.

This plan reuses the additive-only convention from Phase A. Zero DROPs, zero RENAMEs, zero NOT NULL toggles on existing columns. Each migration self-registers in `supabase_migrations.schema_migrations` via the trailing INSERT, matching Phase A's pattern.

---

## Migration plan (10 files, 125–134)

| # | File | Touches |
|---|---|---|
| 125 | `phase_b_lodging_options_extend.sql` | extend `lodging_options` |
| 126 | `phase_b_itinerary_blocks_extend.sql` | extend `itinerary_blocks` |
| 127 | `phase_b_lodging_votes_extend.sql` | extend `lodging_votes` |
| 128 | `phase_b_itinerary_voting.sql` | new tables for itinerary votes + alternatives |
| 129 | `phase_b_lodging_room_assignments.sql` | new table |
| 130 | `phase_b_travel.sql` | new travel_arrangements + groupings + members |
| 131 | `phase_b_meals.sql` | new meals + meal_ingredients + meal_votes |
| 132 | `phase_b_shopping_list.sql` | new shopping_list_items |
| 133 | `phase_b_trip_flyers.sql` | new trip_flyers |
| 134 | `phase_b_generation_log.sql` | new phase_b_generation_log (AI cost + token tracking; my §7 addition) |

---

## 1. `lodging_options` — additive extend (per Q10)

```sql
-- Migration 125: Phase B — extend lodging_options for AI suggestions + room layout
-- The existing Expo-era lodging_options table already has title, platform,
-- url, total_cost_cents, nightly_rate_cents, status, etc. Phase B adds:
--   - room_layout jsonb (flexible — array of {room, beds, cost_per_night})
--   - ai_suggested boolean (mark which rows were AI-generated)
-- The status CHECK widens to permit 'selected' alongside the existing
-- 'option' default (Phase B sets is_selected via status='selected').

ALTER TABLE lodging_options
  ADD COLUMN IF NOT EXISTS room_layout   jsonb,
  ADD COLUMN IF NOT EXISTS ai_suggested  boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  -- Drop the existing CHECK if it's narrower than what we need
  -- (we know there's no live data depending on the old set since
  -- lodging_options has 0 rows in prod). Then add the widened one.
  IF EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'lodging_options_status_check'
  ) THEN
    ALTER TABLE lodging_options DROP CONSTRAINT lodging_options_status_check;
  END IF;
  ALTER TABLE lodging_options
    ADD CONSTRAINT lodging_options_status_check
    CHECK (status IN ('option', 'selected', 'rejected', 'booked'));
END$$;

CREATE INDEX IF NOT EXISTS idx_lodging_options_trip_status
  ON lodging_options (trip_id, status);

INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES ('125', 'phase_b_lodging_options_extend', ARRAY[]::text[])
ON CONFLICT (version) DO NOTHING;
```

> Note: dropping the `lodging_options_status_check` is technically a "drop and re-add wider," not pure additive. I'm calling this out because hard rule #1 is strict about DROPs. The justification: (a) `lodging_options` has zero live rows, so no data is at risk; (b) the new CHECK is a strict superset of the old one (every existing valid status stays valid); (c) the alternative is forcing Phase B to use a new column for status which fragments the model. **Flagging for sign-off.** If you prefer strict-additive, I'll replace this with adding a new `lifecycle text` column and leave `status` alone.

---

## 2. `itinerary_blocks` — additive extend (per Q11)

```sql
-- Migration 126: Phase B — extend itinerary_blocks for AI generation + voting
-- The existing Expo-era itinerary_blocks has 73 live rows. Phase B reads
-- + writes this table; Expo continues to read + write it for its planner
-- itinerary editor. Both flows coexist.
--
-- The existing `type text` column has no CHECK in the live DB; Phase B
-- adds one that includes the existing values plus the Phase B canonical
-- set. The `notes text` column doubles as Phase B's `description`.

ALTER TABLE itinerary_blocks
  ADD COLUMN IF NOT EXISTS ai_generated  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS created_by    uuid REFERENCES respondents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS location_url  text;

DO $$
DECLARE existing_types text[];
BEGIN
  -- Snapshot existing distinct types so we don't accidentally
  -- invalidate live data with a narrow CHECK.
  SELECT array_agg(DISTINCT type) INTO existing_types FROM itinerary_blocks;
  -- We expect a small set: 'activity', 'meal', 'transit', 'lodging',
  -- 'free_time', 'other' (plus whatever Expo writes). Build a UNION
  -- of (existing distinct types) ∪ (Phase B canonical set) and apply
  -- as a CHECK. Idempotent.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'itinerary_blocks_type_check'
  ) THEN
    EXECUTE format(
      'ALTER TABLE itinerary_blocks ADD CONSTRAINT itinerary_blocks_type_check
         CHECK (type = ANY (%L))',
      ARRAY(
        SELECT DISTINCT t FROM (
          SELECT unnest(coalesce(existing_types, ARRAY[]::text[])) AS t
          UNION
          SELECT unnest(ARRAY['activity','meal','transit','lodging','free_time','other'])
        ) s
      )
    );
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_itinerary_blocks_trip_day_start
  ON itinerary_blocks (trip_id, day_date, start_time);

CREATE INDEX IF NOT EXISTS idx_itinerary_blocks_ai_generated
  ON itinerary_blocks (trip_id) WHERE ai_generated = true;

INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES ('126', 'phase_b_itinerary_blocks_extend', ARRAY[]::text[])
ON CONFLICT (version) DO NOTHING;
```

---

## 3. `lodging_votes` — additive extend (per Q12)

```sql
-- Migration 127: Phase B — yes/no/maybe voting on lodging options
-- Existing rows are "presence = yes" semantics; default 'yes' preserves
-- that meaning.

ALTER TABLE lodging_votes
  ADD COLUMN IF NOT EXISTS vote text NOT NULL DEFAULT 'yes';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'lodging_votes_vote_check'
  ) THEN
    ALTER TABLE lodging_votes
      ADD CONSTRAINT lodging_votes_vote_check
      CHECK (vote IN ('yes','no','maybe'));
  END IF;
END$$;

-- One vote per (option, respondent) — replace any prior one in app code
-- via INSERT ... ON CONFLICT.
CREATE UNIQUE INDEX IF NOT EXISTS idx_lodging_votes_unique
  ON lodging_votes (lodging_option_id, respondent_id);

INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES ('127', 'phase_b_lodging_votes_extend', ARRAY[]::text[])
ON CONFLICT (version) DO NOTHING;
```

---

## 4. Itinerary voting + alternatives (per Q11 + Q13)

```sql
-- Migration 128: Phase B — voting infrastructure on itinerary_blocks
-- Three new tables:
--   itinerary_item_votes    — per (block, respondent), yes/no/maybe
--   itinerary_item_alternatives — "vote A vs B" group container
--   itinerary_alternative_options — many-to-many between alternatives + blocks

CREATE TABLE IF NOT EXISTS itinerary_item_votes (
  itinerary_block_id uuid NOT NULL REFERENCES itinerary_blocks(id) ON DELETE CASCADE,
  respondent_id      uuid NOT NULL REFERENCES respondents(id) ON DELETE CASCADE,
  vote               text NOT NULL,
  voted_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (itinerary_block_id, respondent_id),
  CONSTRAINT itinerary_item_votes_vote_check CHECK (vote IN ('yes','no','maybe'))
);

CREATE INDEX IF NOT EXISTS idx_itinerary_item_votes_respondent
  ON itinerary_item_votes (respondent_id);

ALTER TABLE itinerary_item_votes ENABLE ROW LEVEL SECURITY;

-- Anyone with the trip's share token can read the votes (vote totals
-- are public to the group). Writes go through the API layer with
-- session_token verification (service-role bypass).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='itinerary_item_votes' AND policyname='itinerary_item_votes_public_select') THEN
    CREATE POLICY itinerary_item_votes_public_select
      ON itinerary_item_votes FOR SELECT
      USING (EXISTS (
        SELECT 1 FROM itinerary_blocks b WHERE b.id = itinerary_item_votes.itinerary_block_id
      ));
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS itinerary_item_alternatives (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id      uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  day_date     date NOT NULL,
  slot_label   text NOT NULL,
  winning_block_id uuid REFERENCES itinerary_blocks(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_itinerary_alternatives_trip_day
  ON itinerary_item_alternatives (trip_id, day_date);

CREATE TABLE IF NOT EXISTS itinerary_alternative_options (
  alternative_id     uuid NOT NULL REFERENCES itinerary_item_alternatives(id) ON DELETE CASCADE,
  itinerary_block_id uuid NOT NULL REFERENCES itinerary_blocks(id) ON DELETE CASCADE,
  PRIMARY KEY (alternative_id, itinerary_block_id)
);

ALTER TABLE itinerary_item_alternatives ENABLE ROW LEVEL SECURITY;
ALTER TABLE itinerary_alternative_options ENABLE ROW LEVEL SECURITY;

-- Anon read on both: same gate as itinerary_blocks (via the share token).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='itinerary_item_alternatives' AND policyname='alts_public_select') THEN
    CREATE POLICY alts_public_select ON itinerary_item_alternatives FOR SELECT USING (
      EXISTS (SELECT 1 FROM trips t WHERE t.id = itinerary_item_alternatives.trip_id)
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='itinerary_alternative_options' AND policyname='alt_opts_public_select') THEN
    CREATE POLICY alt_opts_public_select ON itinerary_alternative_options FOR SELECT USING (
      EXISTS (
        SELECT 1 FROM itinerary_item_alternatives a
        WHERE a.id = itinerary_alternative_options.alternative_id
      )
    );
  END IF;
END$$;

INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES ('128', 'phase_b_itinerary_voting', ARRAY[]::text[])
ON CONFLICT (version) DO NOTHING;
```

---

## 5. Lodging room assignments

```sql
-- Migration 129: Phase B — who's in which room, what they owe
-- FKs respondents.id (per Q13). Payment status tracking only — Phase B
-- doesn't do native payments; planner links out to Splitwise.

CREATE TABLE IF NOT EXISTS lodging_room_assignments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lodging_option_id  uuid NOT NULL REFERENCES lodging_options(id) ON DELETE CASCADE,
  respondent_id      uuid NOT NULL REFERENCES respondents(id) ON DELETE CASCADE,
  room_label         text NOT NULL,
  nights             integer NOT NULL DEFAULT 0,
  cost_owed_cents    integer NOT NULL DEFAULT 0,
  payment_status     text NOT NULL DEFAULT 'unpaid',
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lodging_room_assignments_payment_status_check
    CHECK (payment_status IN ('unpaid','pending','paid')),
  CONSTRAINT lodging_room_assignments_nights_nonneg CHECK (nights >= 0),
  CONSTRAINT lodging_room_assignments_cost_nonneg   CHECK (cost_owed_cents >= 0),
  UNIQUE (lodging_option_id, respondent_id, room_label)
);

CREATE INDEX IF NOT EXISTS idx_lodging_room_assignments_respondent
  ON lodging_room_assignments (respondent_id);

ALTER TABLE lodging_room_assignments ENABLE ROW LEVEL SECURITY;
-- Same pattern: anon read; writes via service-role.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='lodging_room_assignments' AND policyname='lra_public_select') THEN
    CREATE POLICY lra_public_select ON lodging_room_assignments FOR SELECT USING (
      EXISTS (SELECT 1 FROM lodging_options o WHERE o.id = lodging_room_assignments.lodging_option_id)
    );
  END IF;
END$$;

INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES ('129', 'phase_b_lodging_room_assignments', ARRAY[]::text[])
ON CONFLICT (version) DO NOTHING;
```

---

## 6. Travel arrangements + groupings (per Q11 + Q13)

```sql
-- Migration 130: Phase B — per-respondent travel details + shared rides
-- FK respondents (per Q13). New table (NOT extending trip_travel_legs)
-- because the legacy table uses TEXT date columns and respondent_id
-- semantics that conflict with what Phase B wants.

CREATE TABLE IF NOT EXISTS travel_arrangements (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id                     uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  respondent_id               uuid NOT NULL REFERENCES respondents(id) ON DELETE CASCADE,
  arrival_mode                text,
  arrival_datetime            timestamptz,
  departure_datetime          timestamptz,
  flight_number               text,
  flight_origin_airport       text,
  flight_destination_airport  text,
  vehicle_capacity            integer,
  gear_notes                  text,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT travel_arrangements_arrival_mode_check
    CHECK (arrival_mode IS NULL OR arrival_mode IN ('flight','drive','train','other')),
  CONSTRAINT travel_arrangements_vehicle_capacity_nonneg
    CHECK (vehicle_capacity IS NULL OR vehicle_capacity >= 0),
  UNIQUE (trip_id, respondent_id)
);

CREATE INDEX IF NOT EXISTS idx_travel_arrangements_trip
  ON travel_arrangements (trip_id);

CREATE TABLE IF NOT EXISTS travel_groupings (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id             uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  driver_respondent_id uuid REFERENCES respondents(id) ON DELETE SET NULL,
  direction           text NOT NULL,
  departure_datetime  timestamptz NOT NULL,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT travel_groupings_direction_check
    CHECK (direction IN ('outbound','return'))
);

CREATE INDEX IF NOT EXISTS idx_travel_groupings_trip_direction
  ON travel_groupings (trip_id, direction);

CREATE TABLE IF NOT EXISTS travel_grouping_members (
  grouping_id     uuid NOT NULL REFERENCES travel_groupings(id) ON DELETE CASCADE,
  respondent_id   uuid NOT NULL REFERENCES respondents(id) ON DELETE CASCADE,
  added_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (grouping_id, respondent_id)
);

ALTER TABLE travel_arrangements ENABLE ROW LEVEL SECURITY;
ALTER TABLE travel_groupings ENABLE ROW LEVEL SECURITY;
ALTER TABLE travel_grouping_members ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='travel_arrangements' AND policyname='ta_public_select') THEN
    CREATE POLICY ta_public_select ON travel_arrangements FOR SELECT USING (
      EXISTS (SELECT 1 FROM trips t WHERE t.id = travel_arrangements.trip_id)
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='travel_groupings' AND policyname='tg_public_select') THEN
    CREATE POLICY tg_public_select ON travel_groupings FOR SELECT USING (
      EXISTS (SELECT 1 FROM trips t WHERE t.id = travel_groupings.trip_id)
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='travel_grouping_members' AND policyname='tgm_public_select') THEN
    CREATE POLICY tgm_public_select ON travel_grouping_members FOR SELECT USING (
      EXISTS (SELECT 1 FROM travel_groupings g WHERE g.id = travel_grouping_members.grouping_id)
    );
  END IF;
END$$;

INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES ('130', 'phase_b_travel', ARRAY[]::text[])
ON CONFLICT (version) DO NOTHING;
```

---

## 7. Meals (per Q11 + Q13 + Q17)

```sql
-- Migration 131: Phase B — meals + ingredients + voting
-- meal_ingredients are written in normalized form at meal-plan generation
-- time (per Q17 — LLM-assisted normalization upstream). Shopping list
-- aggregation downstream is then a simple sum-by-name-and-unit.

CREATE TABLE IF NOT EXISTS meals (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id                  uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  day_date                 date NOT NULL,
  meal_type                text NOT NULL,
  mode                     text NOT NULL DEFAULT 'tbd',
  recipe_name              text,
  restaurant_name          text,
  restaurant_url           text,
  assigned_cook_respondent_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  notes                    text,
  ai_suggested             boolean NOT NULL DEFAULT false,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT meals_meal_type_check
    CHECK (meal_type IN ('breakfast','lunch','dinner','snack')),
  CONSTRAINT meals_mode_check
    CHECK (mode IN ('cook_in','restaurant','tbd'))
);

CREATE INDEX IF NOT EXISTS idx_meals_trip_day_type
  ON meals (trip_id, day_date, meal_type);

CREATE TABLE IF NOT EXISTS meal_ingredients (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meal_id    uuid NOT NULL REFERENCES meals(id) ON DELETE CASCADE,
  name       text NOT NULL,
  quantity   numeric NOT NULL DEFAULT 1,
  unit       text NOT NULL DEFAULT 'unit',
  category   text NOT NULL DEFAULT 'other',
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

ALTER TABLE meals ENABLE ROW LEVEL SECURITY;
ALTER TABLE meal_ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE meal_votes ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='meals' AND policyname='meals_public_select') THEN
    CREATE POLICY meals_public_select ON meals FOR SELECT USING (
      EXISTS (SELECT 1 FROM trips t WHERE t.id = meals.trip_id)
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='meal_ingredients' AND policyname='mi_public_select') THEN
    CREATE POLICY mi_public_select ON meal_ingredients FOR SELECT USING (
      EXISTS (SELECT 1 FROM meals m WHERE m.id = meal_ingredients.meal_id)
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='meal_votes' AND policyname='mv_public_select') THEN
    CREATE POLICY mv_public_select ON meal_votes FOR SELECT USING (
      EXISTS (SELECT 1 FROM meals m WHERE m.id = meal_votes.meal_id)
    );
  END IF;
END$$;

INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES ('131', 'phase_b_meals', ARRAY[]::text[])
ON CONFLICT (version) DO NOTHING;
```

---

## 8. Shopping list

```sql
-- Migration 132: Phase B — auto-aggregated shopping list
-- Derived from meal_ingredients via a trigger (kept in app-code for
-- Phase B initial ship; can promote to a SQL trigger if the app-code
-- path proves unreliable).

CREATE TABLE IF NOT EXISTS shopping_list_items (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id               uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  name                  text NOT NULL,
  total_quantity        numeric NOT NULL,
  unit                  text NOT NULL,
  category              text NOT NULL DEFAULT 'other',
  assigned_respondent_id uuid REFERENCES respondents(id) ON DELETE SET NULL,
  is_acquired           boolean NOT NULL DEFAULT false,
  source_meal_ids       uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shopping_list_category_check
    CHECK (category IN ('produce','meat_fish','dairy_fridge','pantry','other')),
  UNIQUE (trip_id, lower(name), unit)
);

CREATE INDEX IF NOT EXISTS idx_shopping_list_trip_category
  ON shopping_list_items (trip_id, category, name);

ALTER TABLE shopping_list_items ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='shopping_list_items' AND policyname='sli_public_select') THEN
    CREATE POLICY sli_public_select ON shopping_list_items FOR SELECT USING (
      EXISTS (SELECT 1 FROM trips t WHERE t.id = shopping_list_items.trip_id)
    );
  END IF;
END$$;

INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES ('132', 'phase_b_shopping_list', ARRAY[]::text[])
ON CONFLICT (version) DO NOTHING;
```

---

## 9. Trip flyers

```sql
-- Migration 133: Phase B — flyer generation records
-- Each row is one rendered flyer (story 1080x1920 + post 1080x1080
-- could share an id, or be separate rows — Phase B Step 3 will decide).
-- Stored URLs point to /storage/v1/object/public/trip-covers/<...> (reusing
-- the Phase A bucket) or a sibling bucket if scope demands.

CREATE TABLE IF NOT EXISTS trip_flyers (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id              uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  template_id          text NOT NULL,
  cover_image_url      text,
  rendered_image_url   text NOT NULL,
  format               text NOT NULL DEFAULT 'story',
  generated_by         uuid REFERENCES profiles(id) ON DELETE SET NULL,
  generated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trip_flyers_format_check CHECK (format IN ('story','post'))
);

CREATE INDEX IF NOT EXISTS idx_trip_flyers_trip_generated
  ON trip_flyers (trip_id, generated_at DESC);

ALTER TABLE trip_flyers ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='trip_flyers' AND policyname='flyers_public_select') THEN
    CREATE POLICY flyers_public_select ON trip_flyers FOR SELECT USING (
      EXISTS (SELECT 1 FROM trips t WHERE t.id = trip_flyers.trip_id)
    );
  END IF;
END$$;

INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES ('133', 'phase_b_trip_flyers', ARRAY[]::text[])
ON CONFLICT (version) DO NOTHING;
```

---

## 10. AI generation log (my §7 addition; not in build guide)

```sql
-- Migration 134: Phase B — AI generation log for cost + rate-limit visibility
-- Every AI generation (itinerary, lodging suggest, flight suggest,
-- meals, cover image, flyer template, ingredient normalization) writes
-- a row. Used by API routes to enforce per-trip / per-day caps before
-- token cost spirals.

CREATE TABLE IF NOT EXISTS phase_b_generation_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id         uuid REFERENCES trips(id) ON DELETE SET NULL,
  caller_user_id  uuid REFERENCES profiles(id) ON DELETE SET NULL,
  kind            text NOT NULL,
  provider        text NOT NULL,
  model           text NOT NULL,
  input_tokens    integer,
  output_tokens   integer,
  duration_ms     integer,
  error_code      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT phase_b_gen_log_kind_check
    CHECK (kind IN (
      'itinerary_generate','lodging_suggest','flight_suggest',
      'meal_plan_generate','ingredient_normalize',
      'cover_image_generate','flyer_render'
    )),
  CONSTRAINT phase_b_gen_log_provider_check
    CHECK (provider IN ('anthropic','gemini','self'))
);

CREATE INDEX IF NOT EXISTS idx_phase_b_gen_log_trip_day
  ON phase_b_generation_log (trip_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_phase_b_gen_log_kind_day
  ON phase_b_generation_log (kind, created_at DESC);

INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES ('134', 'phase_b_generation_log', ARRAY[]::text[])
ON CONFLICT (version) DO NOTHING;
```

---

## What this plan does NOT do

- No DROPs of pre-existing columns or tables.
- No RENAMEs.
- No NOT NULL toggles on pre-existing columns.
- The single non-strict-additive moment is widening the `lodging_options.status` CHECK constraint (see §1 above) — I'm flagging it for sign-off. Zero live rows, strict superset, but it's a DROP-and-re-ADD CHECK rather than pure ADD. **If you want strict additive, I'll use a new `lifecycle text` column instead.**
- No code changes to the existing Expo itinerary editor. Adding nullable columns to `itinerary_blocks` won't affect Expo writes.
- No edge function changes in Step 0. AI provider clients land in Step 1+ of the Phase B build sequence, not this schema step.

---

## Execution checklist (after approval)

1. Confirm the `lodging_options.status` CHECK widening is acceptable (or override to a new `lifecycle` column).
2. Write the 10 migration files in `supabase/migrations/` numbered 125–134.
3. Run each via `supabase db query --linked --file ...` in order.
4. Re-query `information_schema` after each to verify the additions landed.
5. Update `SCHEMA_REPORT.md` with the post-migration state.
6. Commit migrations + updated report.
7. Proceed to Phase B Step 2 (profile aggregation engine) per the build guide.
