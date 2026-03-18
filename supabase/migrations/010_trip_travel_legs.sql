-- Trip Travel Legs
-- Stores planner-created (and future respondent-created) transport legs.
-- shared_with_group controls visibility in the group section.

CREATE TABLE IF NOT EXISTS trip_travel_legs (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id         uuid        NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  respondent_id   uuid        REFERENCES respondents(id) ON DELETE SET NULL,
  mode            text        NOT NULL DEFAULT 'flight',
  label           text        NOT NULL,
  departure_date  text,
  departure_time  text,
  arrival_date    text,
  arrival_time    text,
  booking_ref     text,
  notes           text,
  shared_with_group boolean   NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE trip_travel_legs ENABLE ROW LEVEL SECURITY;

-- Planner (authenticated user who owns the trip) can do everything
CREATE POLICY "planner can manage travel legs"
  ON trip_travel_legs FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM trips
      WHERE trips.id = trip_travel_legs.trip_id
        AND trips.created_by = auth.uid()
    )
  );

-- Anyone can read legs that belong to a trip (for respond page / group view)
-- Filtered by shared_with_group in application logic
CREATE POLICY "anyone can read travel legs"
  ON trip_travel_legs FOR SELECT
  USING (true);
