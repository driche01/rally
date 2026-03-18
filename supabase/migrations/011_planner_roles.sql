-- Planner Roles
-- Allows trip planners to designate group members (respondents) as co-planners.
-- The original trip creator (trips.created_by) is always an implicit planner.

ALTER TABLE respondents ADD COLUMN IF NOT EXISTS is_planner boolean NOT NULL DEFAULT false;

-- Allow the trip owner (Supabase auth user who created the trip) to update
-- is_planner on any respondent belonging to their trip.
CREATE POLICY "trip owner can manage planner status"
  ON respondents FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM trips
      WHERE trips.id = respondents.trip_id
        AND trips.created_by = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM trips
      WHERE trips.id = respondents.trip_id
        AND trips.created_by = auth.uid()
    )
  );
