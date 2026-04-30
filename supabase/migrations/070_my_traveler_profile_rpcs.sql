-- ============================================================
-- Migration 070: my-traveler-profile RPCs (authenticated user path)
--
-- Until now traveler-profile reads/writes only had the anon survey
-- path (share_token + phone gate). This adds an authenticated-user
-- path so the mobile app can show + edit the profile via:
--   • onboarding immediately after signup
--   • a "Travel preferences" row on the Account tab
--
-- Both RPCs resolve auth.uid() → users.auth_user_id → users.phone,
-- then read/write the traveler_profiles row keyed off that phone.
-- ============================================================

CREATE OR REPLACE FUNCTION get_my_traveler_profile()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid;
  v_phone text;
  v_row   traveler_profiles%ROWTYPE;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT u.phone INTO v_phone
  FROM users u
  WHERE u.auth_user_id = v_uid
  LIMIT 1;
  IF v_phone IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_row FROM traveler_profiles WHERE phone = v_phone;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN to_jsonb(v_row);
END;
$$;

GRANT EXECUTE ON FUNCTION get_my_traveler_profile() TO authenticated;

CREATE OR REPLACE FUNCTION upsert_my_traveler_profile(p_profile jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid;
  v_user_id uuid;
  v_phone   text;
  v_row     traveler_profiles%ROWTYPE;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  IF p_profile IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_args');
  END IF;

  SELECT u.id, u.phone INTO v_user_id, v_phone
  FROM users u
  WHERE u.auth_user_id = v_uid
  LIMIT 1;
  IF v_phone IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_phone_on_account');
  END IF;

  INSERT INTO traveler_profiles (
    phone,
    user_id,
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
    v_phone,
    v_user_id,
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
    user_id              = COALESCE(traveler_profiles.user_id, EXCLUDED.user_id),
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

GRANT EXECUTE ON FUNCTION upsert_my_traveler_profile(jsonb) TO authenticated;
