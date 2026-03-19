-- Allow trip members to read the profile of their trip's planner (creator).
-- Without this, only the profile owner can read their own profile, so
-- group members see no planner row on the members screen.

CREATE POLICY "Trip members can read their planner profile"
  ON profiles FOR SELECT
  USING (
    id IN (
      SELECT trips.created_by
      FROM trips
      JOIN trip_members ON trip_members.trip_id = trips.id
      WHERE trip_members.user_id = auth.uid()
    )
  );
