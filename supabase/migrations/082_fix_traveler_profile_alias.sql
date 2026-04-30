-- Fix typo in upsert_my_traveler_profile from migration 076.
--
-- The bootstrap-phone lookup referenced `p.phone` against an unaliased
-- `profiles` table:
--   SELECT p.phone INTO v_profile_phone FROM profiles WHERE id = v_uid;
-- which Postgres rejects with `missing FROM-clause entry for table "p"`.
-- The save would surface that error to the planner before any data
-- could be written. This redefines the function with the alias added.

CREATE OR REPLACE FUNCTION upsert_my_traveler_profile(p_profile jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid           uuid;
  v_user_id       uuid;
  v_phone         text;
  v_profile_phone text;
  v_row           traveler_profiles%ROWTYPE;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  IF p_profile IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_args');
  END IF;

  -- 1. Try the existing users row by auth link.
  SELECT u.id, u.phone INTO v_user_id, v_phone
  FROM   users u
  WHERE  u.auth_user_id = v_uid
  LIMIT  1;

  -- 2. No users row yet — bootstrap from profiles.phone. The trigger in
  --    migration 074/076 normally handles this on profile create, but
  --    older accounts (and a brief window between profile insert and
  --    trigger fire) can land here. Idempotent.
  IF v_phone IS NULL THEN
    SELECT pr.phone INTO v_profile_phone FROM profiles pr WHERE pr.id = v_uid;
    IF v_profile_phone IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'phone_required');
    END IF;

    INSERT INTO users (phone, display_name, email, rally_account, auth_user_id)
    SELECT v_profile_phone, pr.name, pr.email, true, v_uid
    FROM   profiles pr WHERE pr.id = v_uid
    ON CONFLICT (phone) DO UPDATE SET
      auth_user_id  = EXCLUDED.auth_user_id,
      rally_account = true,
      display_name  = COALESCE(users.display_name, EXCLUDED.display_name),
      email         = COALESCE(users.email, EXCLUDED.email)
    RETURNING id INTO v_user_id;

    v_phone := v_profile_phone;
  END IF;

  -- 3. Upsert the traveler-profile row (keyed by phone).
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
