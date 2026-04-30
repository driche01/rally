-- Self-heal the auth → users row link when saving a traveler profile.
--
-- Until now upsert_my_traveler_profile required users.phone to already
-- be set for the authed caller. That breaks for any fresh signup that
-- enters profile.phone via the profile-setup flow but doesn't yet have
-- a users row (no SMS history, no contact-import bootstrap), because
-- the migration 074 trigger only UPDATEs an existing users row — it
-- doesn't INSERT one.
--
-- Two changes:
--   1. upsert_my_traveler_profile: when no users row exists for the
--      auth user, fall back to profiles.phone and bootstrap a users
--      row (linking any unclaimed phone-only row via ON CONFLICT).
--   2. sync_profile_phone_to_users trigger: also INSERT a users row
--      when there's no existing one for the auth user.

-- ─── Trigger function (replaces the version in migration 074) ──────────────
CREATE OR REPLACE FUNCTION sync_profile_phone_to_users()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.phone IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.phone IS NOT DISTINCT FROM OLD.phone THEN
    RETURN NEW;
  END IF;

  UPDATE users
  SET    phone = NEW.phone
  WHERE  auth_user_id = NEW.id
    AND  phone IS DISTINCT FROM NEW.phone;

  -- No users row for this auth user yet — bootstrap one. ON CONFLICT
  -- handles the case where an unclaimed users row already owns this
  -- phone (e.g. SMS-imported contact who later signs up).
  IF NOT FOUND THEN
    INSERT INTO users (phone, display_name, email, rally_account, auth_user_id)
    VALUES (NEW.phone, NEW.name, NEW.email, true, NEW.id)
    ON CONFLICT (phone) DO UPDATE SET
      auth_user_id  = EXCLUDED.auth_user_id,
      rally_account = true,
      display_name  = COALESCE(users.display_name, EXCLUDED.display_name),
      email         = COALESCE(users.email, EXCLUDED.email);
  END IF;

  RETURN NEW;
END;
$$;

-- ─── upsert_my_traveler_profile (replaces migration 070) ───────────────────
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
    SELECT p.phone INTO v_profile_phone FROM profiles WHERE id = v_uid;
    IF v_profile_phone IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'phone_required');
    END IF;

    INSERT INTO users (phone, display_name, email, rally_account, auth_user_id)
    SELECT v_profile_phone, p.name, p.email, true, v_uid
    FROM   profiles p WHERE p.id = v_uid
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
