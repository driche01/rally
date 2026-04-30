-- ============================================================
-- Migration 080: Make app_create_sms_session resilient to a
-- phone-less planner.
--
-- Before this migration, the function bailed with
-- `profile_missing_phone` whenever the planner's profile.phone was
-- null. That was reasonable in the SMS-conversational era where the
-- planner had to be reachable by SMS to drive the trip — but in the
-- post-pivot, app-driven world the planner adds people from inside
-- the app. Their own phone matters only when they want to be looped
-- into the SMS thread themselves, and we'd rather a working trip
-- without their phone than no trip at all.
--
-- Resolution order for the planner's users.id:
--   1. users row already linked via users.auth_user_id = auth.uid()
--   2. profile.phone (legacy — what the old code checked)
--   3. auth.users.phone (covers phone-OTP signups whose profile
--      hasn't been synced yet)
--   4. None of the above → create the session with
--      planner_user_id = NULL and skip the planner-participant
--      insert. Trip works, contacts can still flow in via
--      app_add_trip_contacts; planner can be back-filled later if
--      they add a phone.
-- ============================================================

CREATE OR REPLACE FUNCTION app_create_sms_session(p_trip_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid              uuid;
  v_users_id         uuid;
  v_normalized_phone text;
  v_candidate_phone  text;
  v_session_id       uuid;
  v_thread_id        text;
  v_trip_owned       boolean;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  -- Trip must exist and the caller must own it (or be a member).
  SELECT EXISTS (
    SELECT 1 FROM trips t
    WHERE  t.id = p_trip_id
      AND  (
        t.created_by = v_uid
        OR EXISTS (
          SELECT 1 FROM trip_members tm
          WHERE tm.trip_id = p_trip_id AND tm.user_id = v_uid
        )
      )
  ) INTO v_trip_owned;

  IF NOT v_trip_owned THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  -- ─── Resolve planner_user_id, best-effort ────────────────────────────
  -- 1. Linked users row.
  SELECT id INTO v_users_id FROM users WHERE auth_user_id = v_uid LIMIT 1;

  IF v_users_id IS NULL THEN
    -- 2. profile.phone fallback (legacy email/Google signups that
    --    captured a phone in the profile setup screen).
    SELECT phone INTO v_candidate_phone FROM profiles WHERE id = v_uid;

    -- 3. auth.users.phone fallback (phone-OTP signups that haven't
    --    been synced yet). nullif() collapses '' → NULL so the
    --    coalesce below treats empty strings as missing.
    IF nullif(v_candidate_phone, '') IS NULL THEN
      SELECT nullif(phone, '') INTO v_candidate_phone FROM auth.users WHERE id = v_uid;
    END IF;

    v_normalized_phone := normalize_phone(v_candidate_phone);

    IF v_normalized_phone IS NOT NULL THEN
      -- Find or create the users row.
      SELECT id INTO v_users_id FROM users WHERE phone = v_normalized_phone;
      IF v_users_id IS NULL THEN
        INSERT INTO users (phone, display_name, rally_account, auth_user_id)
        VALUES (
          v_normalized_phone,
          (SELECT name FROM profiles WHERE id = v_uid),
          true,
          v_uid
        )
        RETURNING id INTO v_users_id;
      ELSE
        UPDATE users
        SET    auth_user_id = v_uid, rally_account = true
        WHERE  id = v_users_id AND auth_user_id IS NULL;
      END IF;
    END IF;
    -- v_users_id may still be null at this point — that's fine.
    -- The session is created without a planner participant, and
    -- the planner can be backfilled if/when they add a phone.
  END IF;

  -- ─── Find or create the live session ─────────────────────────────────
  SELECT id, thread_id
  INTO   v_session_id, v_thread_id
  FROM   trip_sessions
  WHERE  trip_id = p_trip_id
    AND  status IN ('ACTIVE', 'PAUSED', 'RE_ENGAGEMENT_PENDING', 'FIRST_BOOKING_REACHED')
  LIMIT  1;

  IF v_session_id IS NULL THEN
    v_thread_id := 'app_pending_' || p_trip_id::text;
    INSERT INTO trip_sessions (
      trip_id, thread_id, planner_user_id, phase, status, last_message_at, created_at
    )
    VALUES (
      p_trip_id, v_thread_id, v_users_id, 'INTRO', 'ACTIVE', now(), now()
    )
    RETURNING id INTO v_session_id;
  ELSIF v_users_id IS NOT NULL THEN
    -- Session already existed. If we now have a planner_user_id and the
    -- session didn't, back-fill it — handles the "trip was created
    -- pre-phone, planner added phone later" flow.
    UPDATE trip_sessions
    SET    planner_user_id = v_users_id
    WHERE  id = v_session_id AND planner_user_id IS NULL;
  END IF;

  -- ─── Planner participant — only if we have a phone for them ─────────
  IF v_users_id IS NOT NULL THEN
    INSERT INTO trip_session_participants (
      trip_session_id, user_id, phone, display_name, status, is_planner
    )
    SELECT v_session_id,
           v_users_id,
           u.phone,
           u.display_name,
           'active',
           true
    FROM   users u
    WHERE  u.id = v_users_id
    ON CONFLICT (trip_session_id, phone) DO UPDATE
      SET is_planner = true,
          updated_at = now();
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'session_id', v_session_id,
    'thread_id', v_thread_id,
    'pending', v_thread_id LIKE 'app_pending_%',
    'planner_pending', v_users_id IS NULL
  );
END;
$$;

GRANT EXECUTE ON FUNCTION app_create_sms_session(uuid) TO authenticated;
