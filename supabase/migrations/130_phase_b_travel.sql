-- ============================================================
-- Migration 130: Phase B — travel arrangements + shared rides
--
-- Three new tables. trip_travel_legs (Expo) is left alone — it
-- uses TEXT date columns and a different per-respondent shape.
-- Phase B's travel_arrangements is the canonical new entity; FK
-- to respondents(id) per Q13.
-- ============================================================

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
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id               uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  driver_respondent_id  uuid REFERENCES respondents(id) ON DELETE SET NULL,
  direction             text NOT NULL,
  departure_datetime    timestamptz NOT NULL,
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT travel_groupings_direction_check
    CHECK (direction IN ('outbound','return'))
);

CREATE INDEX IF NOT EXISTS idx_travel_groupings_trip_direction
  ON travel_groupings (trip_id, direction);

CREATE TABLE IF NOT EXISTS travel_grouping_members (
  grouping_id    uuid NOT NULL REFERENCES travel_groupings(id) ON DELETE CASCADE,
  respondent_id  uuid NOT NULL REFERENCES respondents(id) ON DELETE CASCADE,
  added_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (grouping_id, respondent_id)
);

ALTER TABLE travel_arrangements      ENABLE ROW LEVEL SECURITY;
ALTER TABLE travel_groupings         ENABLE ROW LEVEL SECURITY;
ALTER TABLE travel_grouping_members  ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='travel_arrangements' AND policyname='ta_public_select') THEN
    CREATE POLICY ta_public_select ON travel_arrangements FOR SELECT
      USING (EXISTS (SELECT 1 FROM trips t WHERE t.id = travel_arrangements.trip_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='travel_groupings' AND policyname='tg_public_select') THEN
    CREATE POLICY tg_public_select ON travel_groupings FOR SELECT
      USING (EXISTS (SELECT 1 FROM trips t WHERE t.id = travel_groupings.trip_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='travel_grouping_members' AND policyname='tgm_public_select') THEN
    CREATE POLICY tgm_public_select ON travel_grouping_members FOR SELECT
      USING (EXISTS (
        SELECT 1 FROM travel_groupings g WHERE g.id = travel_grouping_members.grouping_id
      ));
  END IF;
END$$;

INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES ('130', 'phase_b_travel', ARRAY[]::text[])
ON CONFLICT (version) DO NOTHING;
