-- ============================================================
-- Migration 063: widen the traveler-profile RPC auth gate
--
-- The original 062 RPCs only authorized a phone if it was on
-- `trip_session_participants` for the trip's session. But a respondent
-- may have entered a phone that the planner didn't pre-add as a
-- contact (e.g., they got the link forwarded by another participant).
-- In that case getOrCreateRespondent inserts them into `respondents`
-- but NOT into trip_session_participants — so the original gate
-- rejected them with "forbidden" on save.
--
-- Fix: also accept the respondent path. If the phone matches a
-- `respondents` row for the trip, the gate authorizes. This still
-- requires the caller to know both the share_token (from their SMS
-- link) AND the phone they entered into the survey, so the access
-- model stays scoped — anyone who completed the survey for this trip
-- can read/write their own profile.
-- ============================================================

CREATE OR REPLACE FUNCTION get_traveler_profile_by_token(
  p_share_token text,
  p_phone       text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_authorized boolean;
  v_row        traveler_profiles%ROWTYPE;
BEGIN
  IF p_share_token IS NULL OR p_phone IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM trip_session_participants p
    JOIN trip_sessions s ON s.id = p.trip_session_id
    JOIN trips t         ON t.id = s.trip_id
    WHERE t.share_token = p_share_token
      AND p.phone = p_phone
    UNION ALL
    SELECT 1
    FROM respondents r
    JOIN trips t ON t.id = r.trip_id
    WHERE t.share_token = p_share_token
      AND r.phone = p_phone
  ) INTO v_authorized;

  IF NOT v_authorized THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_row FROM traveler_profiles WHERE phone = p_phone;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN to_jsonb(v_row);
END;
$$;

CREATE OR REPLACE FUNCTION upsert_traveler_profile_by_token(
  p_share_token text,
  p_phone       text,
  p_profile     jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_authorized boolean;
  v_row        traveler_profiles%ROWTYPE;
BEGIN
  IF p_share_token IS NULL OR p_phone IS NULL OR p_profile IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_args');
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM trip_session_participants p
    JOIN trip_sessions s ON s.id = p.trip_session_id
    JOIN trips t         ON t.id = s.trip_id
    WHERE t.share_token = p_share_token
      AND p.phone = p_phone
    UNION ALL
    SELECT 1
    FROM respondents r
    JOIN trips t ON t.id = r.trip_id
    WHERE t.share_token = p_share_token
      AND r.phone = p_phone
  ) INTO v_authorized;

  IF NOT v_authorized THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  INSERT INTO traveler_profiles (
    phone,
    home_airport,
    travel_pref,
    flight_dealbreakers,
    sleep_pref,
    lodging_pref,
    dietary_restrictions,
    dietary_specifics,
    meal_pref,
    drinking_pref,
    physical_limitations,
    physical_specifics,
    trip_pace,
    activity_types,
    budget_posture,
    notes
  ) VALUES (
    p_phone,
    p_profile->>'home_airport',
    p_profile->>'travel_pref',
    COALESCE((SELECT array_agg(value::text) FROM jsonb_array_elements_text(p_profile->'flight_dealbreakers')), '{}'::text[]),
    p_profile->>'sleep_pref',
    p_profile->>'lodging_pref',
    COALESCE((SELECT array_agg(value::text) FROM jsonb_array_elements_text(p_profile->'dietary_restrictions')), '{}'::text[]),
    p_profile->>'dietary_specifics',
    p_profile->>'meal_pref',
    p_profile->>'drinking_pref',
    COALESCE((SELECT array_agg(value::text) FROM jsonb_array_elements_text(p_profile->'physical_limitations')), '{}'::text[]),
    p_profile->>'physical_specifics',
    NULLIF(p_profile->>'trip_pace', '')::int,
    COALESCE((SELECT array_agg(value::text) FROM jsonb_array_elements_text(p_profile->'activity_types')), '{}'::text[]),
    p_profile->>'budget_posture',
    p_profile->>'notes'
  )
  ON CONFLICT (phone) DO UPDATE SET
    home_airport         = EXCLUDED.home_airport,
    travel_pref          = EXCLUDED.travel_pref,
    flight_dealbreakers  = EXCLUDED.flight_dealbreakers,
    sleep_pref           = EXCLUDED.sleep_pref,
    lodging_pref         = EXCLUDED.lodging_pref,
    dietary_restrictions = EXCLUDED.dietary_restrictions,
    dietary_specifics    = EXCLUDED.dietary_specifics,
    meal_pref            = EXCLUDED.meal_pref,
    drinking_pref        = EXCLUDED.drinking_pref,
    physical_limitations = EXCLUDED.physical_limitations,
    physical_specifics   = EXCLUDED.physical_specifics,
    trip_pace            = EXCLUDED.trip_pace,
    activity_types       = EXCLUDED.activity_types,
    budget_posture       = EXCLUDED.budget_posture,
    notes                = EXCLUDED.notes
  RETURNING * INTO v_row;

  RETURN jsonb_build_object('ok', true, 'profile', to_jsonb(v_row));
END;
$$;

GRANT EXECUTE ON FUNCTION get_traveler_profile_by_token(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION upsert_traveler_profile_by_token(text, text, jsonb) TO anon, authenticated;
