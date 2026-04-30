-- ============================================================
-- Migration 064: SECURITY DEFINER RPC for planner-side reads
--
-- The original 062 design relied on RLS to gate planner reads of
-- `traveler_profiles`. The policy required a join through
-- `trip_session_participants` AND `trip_members` (auth.uid()), which
-- in practice was filtering out legitimate profiles in the Group
-- Dashboard. Symptom: David's filled profile didn't show up — even
-- though the row existed in the DB and the participant's phone
-- matched.
--
-- Cleaner contract: explicit RPC. The function verifies the caller
-- is a member of the trip whose session is being queried, then
-- returns one row per active participant joined to their profile
-- (NULL when not yet filled out).
-- ============================================================

CREATE OR REPLACE FUNCTION get_traveler_profiles_for_trip_session(
  p_session_id uuid
)
RETURNS TABLE (
  participant_id uuid,
  phone          text,
  display_name   text,
  profile        jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid        uuid;
  v_trip_id    uuid;
  v_authorized boolean;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  -- Resolve the trip_id from the session, then verify the caller is
  -- a member of that trip.
  SELECT s.trip_id INTO v_trip_id
  FROM trip_sessions s
  WHERE s.id = p_session_id;
  IF v_trip_id IS NULL THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM trip_members tm
    WHERE tm.trip_id = v_trip_id AND tm.user_id = v_uid
  ) INTO v_authorized;

  IF NOT v_authorized THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    p.id                AS participant_id,
    p.phone             AS phone,
    p.display_name      AS display_name,
    CASE WHEN tp.phone IS NULL THEN NULL ELSE to_jsonb(tp.*) END AS profile
  FROM trip_session_participants p
  LEFT JOIN traveler_profiles tp ON tp.phone = p.phone
  WHERE p.trip_session_id = p_session_id
    AND p.status = 'active'
  ORDER BY p.joined_at NULLS LAST, p.id;
END;
$$;

GRANT EXECUTE ON FUNCTION get_traveler_profiles_for_trip_session(uuid) TO authenticated;
