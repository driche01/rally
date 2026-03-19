-- Fix infinite recursion in trips RLS.
--
-- The trips SELECT policy queries trip_members, and the trip_members SELECT
-- policy queries trips → circular dependency → 42P17.
--
-- Solution: wrap the trip_members lookup in a SECURITY DEFINER function so it
-- runs without RLS, breaking the cycle.

-- Helper: check if the current user is a member of a given trip.
-- SECURITY DEFINER bypasses RLS on trip_members, preventing the cycle.
CREATE OR REPLACE FUNCTION auth_user_is_trip_member(p_trip_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM trip_members
    WHERE trip_members.trip_id = p_trip_id
      AND trip_members.user_id = auth.uid()
  )
$$;

-- Replace the recursive SELECT policy with one that uses the helper
DROP POLICY IF EXISTS "Authenticated users can read their own trips" ON trips;

CREATE POLICY "Authenticated users can read their own trips"
  ON trips FOR SELECT
  USING (
    auth.role() = 'authenticated'
    AND (
      auth.uid() = created_by
      OR auth_user_is_trip_member(trips.id)
    )
  );
