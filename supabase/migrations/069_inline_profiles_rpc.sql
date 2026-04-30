-- ============================================================
-- Migration 069: rewrite the planner profiles RPC without CTEs
--
-- The diagnostic in 068 confirmed the data exists for the test
-- session: 1 active participant + 1 respondent (different phone) +
-- 1 saved profile keyed off the respondent's phone. Yet the
-- CTE-based version of `get_traveler_profiles_for_trip_session`
-- returns 0 rows. Suspect: subtle issue with PL/pgSQL `RETURN QUERY`
-- referencing CTEs across UNION boundaries, or a name-shadow.
--
-- Rewriting with inline subqueries (no `WITH` clause) eliminates that
-- variable. Auth gate is also restored from the loosened 067 version
-- back to the trip-creator-OR-member check.
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
  v_uid        uuid;
  v_trip_id    uuid;
  v_authorized boolean;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  SELECT s.trip_id INTO v_trip_id
  FROM trip_sessions s
  WHERE s.id = p_session_id;
  IF v_trip_id IS NULL THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM trips t
    WHERE t.id = v_trip_id AND t.created_by = v_uid
    UNION ALL
    SELECT 1 FROM trip_members tm
    WHERE tm.trip_id = v_trip_id AND tm.user_id = v_uid
  ) INTO v_authorized;

  IF NOT v_authorized THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    combined.participant_id,
    combined.phone,
    combined.display_name,
    combined.source,
    CASE WHEN tp.phone IS NULL THEN NULL ELSE to_jsonb(tp.*) END AS profile
  FROM (
    SELECT
      p.id           AS participant_id,
      p.phone        AS phone,
      p.display_name AS display_name,
      'participant'::text AS source,
      p.joined_at    AS sort_at
    FROM trip_session_participants p
    WHERE p.trip_session_id = p_session_id
      AND p.status = 'active'

    UNION ALL

    SELECT
      r.id           AS participant_id,
      r.phone        AS phone,
      r.name         AS display_name,
      'respondent'::text AS source,
      r.created_at   AS sort_at
    FROM respondents r
    WHERE r.trip_id = v_trip_id
      AND r.phone IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM trip_session_participants p2
        WHERE p2.trip_session_id = p_session_id
          AND p2.status = 'active'
          AND p2.phone = r.phone
      )
  ) AS combined
  LEFT JOIN traveler_profiles tp ON tp.phone = combined.phone
  ORDER BY combined.sort_at NULLS LAST, combined.participant_id;
END;
$$;

GRANT EXECUTE ON FUNCTION get_traveler_profiles_for_trip_session(uuid) TO authenticated;
