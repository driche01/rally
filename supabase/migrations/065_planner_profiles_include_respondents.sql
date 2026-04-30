-- ============================================================
-- Migration 065: include web respondents in planner-side profile RPC
--
-- Problem: when a respondent fills out the survey via the web link
-- using a phone the planner didn't pre-add as a contact, they end up
-- in `respondents` but NOT in `trip_session_participants`. The
-- migration-064 RPC only joined through trip_session_participants, so
-- their saved traveler_profile was invisible to the planner ("No
-- one's filled out their profile yet").
--
-- Fix: UNION participants + web respondents (dedup by phone), join
-- to traveler_profiles. The Group Dashboard now sees a row for every
-- person who's on this trip via either path.
-- ============================================================

DROP FUNCTION IF EXISTS get_traveler_profiles_for_trip_session(uuid);

CREATE OR REPLACE FUNCTION get_traveler_profiles_for_trip_session(
  p_session_id uuid
)
RETURNS TABLE (
  participant_id uuid,
  phone          text,
  display_name   text,
  source         text,            -- 'participant' | 'respondent'
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
    SELECT 1 FROM trip_members tm
    WHERE tm.trip_id = v_trip_id AND tm.user_id = v_uid
  ) INTO v_authorized;

  IF NOT v_authorized THEN
    RETURN;
  END IF;

  -- Build the union of trip_session_participants + respondents for
  -- this trip, deduping by phone (participants take precedence over
  -- respondents when both rows exist for the same phone).
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
