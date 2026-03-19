-- RPC: enroll_respondent_as_member
--
-- Called from the respond/ web page after a group member submits their first
-- poll responses. It:
--   1. Looks up the auth user by email (needs access to auth.users → SECURITY DEFINER)
--   2. Updates their profile with last_name and phone if not already set
--   3. Inserts a trip_members row (member role), ignoring conflicts
--
-- The caller must have already called supabase.auth.signUp() so the auth user
-- row exists before this function runs.

CREATE OR REPLACE FUNCTION enroll_respondent_as_member(
  p_trip_id   uuid,
  p_email     text,
  p_first_name text,
  p_last_name  text,
  p_phone      text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_user_id uuid;
BEGIN
  -- Look up the auth user by email
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE lower(email) = lower(trim(p_email))
  LIMIT 1;

  IF v_user_id IS NULL THEN
    -- Auth user doesn't exist yet (e.g. signUp hasn't propagated) — nothing to do
    RETURN;
  END IF;

  -- Update profile: fill in last_name and phone if they're missing
  UPDATE profiles SET
    last_name = COALESCE(NULLIF(trim(p_last_name), ''), last_name),
    phone     = COALESCE(NULLIF(trim(p_phone), ''), phone)
  WHERE id = v_user_id;

  -- Add to trip_members; no-op if they're already a member
  INSERT INTO trip_members (trip_id, user_id, role)
  VALUES (p_trip_id, v_user_id, 'member')
  ON CONFLICT (trip_id, user_id) DO NOTHING;
END;
$$;
