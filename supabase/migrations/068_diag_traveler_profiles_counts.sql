-- ============================================================
-- Migration 068: diagnostic RPC — counts per CTE
--
-- Helps pinpoint why `get_traveler_profiles_for_trip_session` is
-- returning 0 rows for a session that the dashboard shows as having
-- both a participant and a web-respondent.
-- ============================================================

CREATE OR REPLACE FUNCTION debug_traveler_profiles_diag(
  p_session_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_trip_id uuid;
  v_total_participants int;
  v_active_participants int;
  v_total_respondents int;
  v_respondents_with_phone int;
  v_distinct_statuses text[];
  v_participant_phones text[];
  v_respondent_phones text[];
  v_profile_phones text[];
BEGIN
  SELECT s.trip_id INTO v_trip_id FROM trip_sessions s WHERE s.id = p_session_id;

  SELECT COUNT(*) INTO v_total_participants
  FROM trip_session_participants WHERE trip_session_id = p_session_id;

  SELECT COUNT(*) INTO v_active_participants
  FROM trip_session_participants WHERE trip_session_id = p_session_id AND status = 'active';

  SELECT array_agg(DISTINCT status) INTO v_distinct_statuses
  FROM trip_session_participants WHERE trip_session_id = p_session_id;

  SELECT array_agg(phone) INTO v_participant_phones
  FROM trip_session_participants WHERE trip_session_id = p_session_id;

  SELECT COUNT(*) INTO v_total_respondents
  FROM respondents WHERE trip_id = v_trip_id;

  SELECT COUNT(*) INTO v_respondents_with_phone
  FROM respondents WHERE trip_id = v_trip_id AND phone IS NOT NULL;

  SELECT array_agg(phone) INTO v_respondent_phones
  FROM respondents WHERE trip_id = v_trip_id AND phone IS NOT NULL;

  -- Profiles for any of the phones we found, regardless of trip
  SELECT array_agg(phone) INTO v_profile_phones
  FROM traveler_profiles
  WHERE phone = ANY(COALESCE(v_participant_phones, '{}'::text[]) || COALESCE(v_respondent_phones, '{}'::text[]));

  RETURN jsonb_build_object(
    'session_id', p_session_id,
    'trip_id', v_trip_id,
    'auth_uid', auth.uid(),
    'total_participants', v_total_participants,
    'active_participants', v_active_participants,
    'distinct_statuses', v_distinct_statuses,
    'participant_phones', v_participant_phones,
    'total_respondents', v_total_respondents,
    'respondents_with_phone', v_respondents_with_phone,
    'respondent_phones', v_respondent_phones,
    'profile_phones', v_profile_phones
  );
END;
$$;

GRANT EXECUTE ON FUNCTION debug_traveler_profiles_diag(uuid) TO authenticated;
