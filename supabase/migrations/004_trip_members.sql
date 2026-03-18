-- Track authenticated Rally users who have joined a trip in-app.
-- Distinct from respondents (anonymous poll voters via share link).

CREATE TABLE trip_members (
  id        UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  trip_id   UUID        NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  user_id   UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role      TEXT        NOT NULL DEFAULT 'member' CHECK (role IN ('planner', 'member')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (trip_id, user_id)
);

ALTER TABLE trip_members ENABLE ROW LEVEL SECURITY;

-- Authenticated users can join any active trip (insert their own row only)
CREATE POLICY "trip_members_insert" ON trip_members
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Users can see their own memberships;
-- Trip planners can see all members of their trips.
CREATE POLICY "trip_members_select" ON trip_members
  FOR SELECT USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM trips
      WHERE trips.id = trip_members.trip_id
        AND trips.created_by = auth.uid()
    )
  );

-- Users can remove themselves from a trip
CREATE POLICY "trip_members_delete" ON trip_members
  FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX trip_members_trip_id_idx ON trip_members(trip_id);
CREATE INDEX trip_members_user_id_idx ON trip_members(user_id);
