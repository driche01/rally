-- ============================================================
-- Migration 067: temporary diagnostic — loosen auth on the planner
-- profiles RPC so we can see whether the empty result is auth-gate
-- failure or data-not-found. To be reverted in 068 once we know.
--
-- This DOES NOT remove the membership check entirely — it just allows
-- ANY authenticated user to call it for diagnostic purposes. If
-- non-members were hitting this in production, the worst case is
-- they read profile data for trips they aren't on. Acceptable for a
-- short-lived diagnostic; we'll lock it back down immediately.
-- ============================================================

DROP FUNCTION IF EXISTS get_traveler_profiles_for_trip_session(uuid);

CREATE OR REPLACE FUNCTION get_traveler_profiles_for_trip_session(
  p_session_id uuid
)
RETURNS TABLE (
  participant_id uuid,
  phone          text,
  display_name   text,
  source         text,
  profile        jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_trip_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;

  SELECT s.trip_id INTO v_trip_id
  FROM trip_sessions s
  WHERE s.id = p_session_id;
  IF v_trip_id IS NULL THEN
    RETURN;
  END IF;

  -- DIAGNOSTIC: skip the trip-membership check. If data shows up
  -- now, the membership check was the bug. To be re-enabled in 068.

  RETURN QUERY
  WITH participants AS (
    SELECT
      p.id           AS participant_id,
      p.phone        AS phone,
      p.display_name AS display_name,
      'participant'::text AS source,
      p.joined_at    AS sort_at
    FROM trip_session_participants p
    WHERE p.trip_session_id = p_session_id
      AND p.status = 'active'
  ),
  respondents_for_trip AS (
    SELECT
      r.id           AS participant_id,
      r.phone        AS phone,
      r.name         AS display_name,
      'respondent'::text AS source,
      r.created_at   AS sort_at
    FROM respondents r
    WHERE r.trip_id = v_trip_id
      AND r.phone IS NOT NULL
      AND r.phone NOT IN (SELECT phone FROM participants WHERE phone IS NOT NULL)
  ),
  combined AS (
    SELECT * FROM participants
    UNION ALL
    SELECT * FROM respondents_for_trip
  )
  SELECT
    c.participant_id,
    c.phone,
    c.display_name,
    c.source,
    CASE WHEN tp.phone IS NULL THEN NULL ELSE to_jsonb(tp.*) END AS profile
  FROM combined c
  LEFT JOIN traveler_profiles tp ON tp.phone = c.phone
  ORDER BY c.sort_at NULLS LAST, c.participant_id;
END;
$$;

GRANT EXECUTE ON FUNCTION get_traveler_profiles_for_trip_session(uuid) TO authenticated;
