-- Restrict trip visibility to creators and members only.
--
-- Previously "Anyone can read a trip by share_token" used USING (true),
-- which allowed any authenticated user to read every trip in the database.
-- We drop that and replace it with:
--   1. Authenticated users can only read trips they created or are a member of.
--   2. Unauthenticated (anon) users retain read access for the public respond/ share page.

DROP POLICY IF EXISTS "Anyone can read a trip by share_token" ON trips;

-- Authenticated users: creator or trip member
CREATE POLICY "Authenticated users can read their own trips"
  ON trips FOR SELECT
  USING (
    auth.role() = 'authenticated'
    AND (
      auth.uid() = created_by
      OR EXISTS (
        SELECT 1 FROM trip_members
        WHERE trip_members.trip_id = trips.id
          AND trip_members.user_id = auth.uid()
      )
    )
  );

-- Unauthenticated users: keep read access for the public group-response page
CREATE POLICY "Unauthenticated users can read trips via share link"
  ON trips FOR SELECT
  USING (auth.role() = 'anon');
