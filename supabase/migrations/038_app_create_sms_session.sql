-- ============================================================
-- Migration 038: App → SMS group activation (Phase 4)
--
-- Lets a planner in the app pre-create an SMS trip_session linked to
-- their existing app-side trip, then add Rally's number to a group
-- chat to "activate" it. The first inbound group message hands the
-- session off to that real thread.
--
-- This RPC is what the new in-app "Get Rally to run this in my group"
-- button calls. It:
--   1. Resolves the planner's `users` row from auth.uid() (creating one
--      from profiles.phone if first-time activator and no SMS history).
--   2. Idempotently upserts a `trip_sessions` row with a placeholder
--      thread_id (`app_pending_<tripId>`). The partial unique index
--      from Phase 0 (trip_sessions_trip_id_live_unique) prevents
--      duplicates.
--   3. Adds the planner to trip_session_participants.
--   4. Returns the session id so the activate-sms screen can subscribe
--      to its `last_message_at` for the "activated" flip.
--
-- Inbound-side handoff (in inbound-processor.ts) reassigns the
-- thread_id when the first real group message arrives — that's how
-- the placeholder gets replaced with the actual Twilio thread.
-- ============================================================

CREATE OR REPLACE FUNCTION app_create_sms_session(p_trip_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid              uuid;
  v_users_id         uuid;
  v_normalized_phone text;
  v_profile_phone    text;
  v_session_id       uuid;
  v_thread_id        text;
  v_trip_owned       boolean;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  -- Trip must exist and the caller must be a member (or its created_by).
  -- Don't let an authed user spin up SMS sessions for trips they don't own.
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

  -- ─── Resolve planner_user_id (the SMS-side users.id) ─────────────────
  SELECT id INTO v_users_id FROM users WHERE auth_user_id = v_uid LIMIT 1;

  IF v_users_id IS NULL THEN
    -- Brand-new app user, never seen by SMS. Bootstrap a users row from
    -- their profile.phone if we have one.
    SELECT phone INTO v_profile_phone FROM profiles WHERE id = v_uid;
    v_normalized_phone := normalize_phone(v_profile_phone);
    IF v_normalized_phone IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'profile_missing_phone');
    END IF;

    -- Phone may already exist (e.g. unclaimed pre-claim flow row, or a
    -- race with a parallel claim). Find first, then create.
    SELECT id INTO v_users_id FROM users WHERE phone = v_normalized_phone;
    IF v_users_id IS NULL THEN
      INSERT INTO users (phone, display_name, rally_account, auth_user_id)
      VALUES (v_normalized_phone,
              (SELECT name FROM profiles WHERE id = v_uid),
              true,
              v_uid)
      RETURNING id INTO v_users_id;
    ELSE
      -- Existing users row, link the auth uid (claim-by-side-effect).
      UPDATE users SET auth_user_id = v_uid, rally_account = true WHERE id = v_users_id AND auth_user_id IS NULL;
    END IF;
  END IF;

  -- ─── Find or create the live session ─────────────────────────────────
  SELECT id, thread_id
  INTO   v_session_id, v_thread_id
  FROM   trip_sessions
  WHERE  trip_id = p_trip_id
    AND  status IN ('ACTIVE', 'PAUSED', 'RE_ENGAGEMENT_PENDING')
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
  END IF;

  -- ─── Ensure the planner is in trip_session_participants ──────────────
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

  RETURN jsonb_build_object(
    'ok', true,
    'session_id', v_session_id,
    'thread_id', v_thread_id,
    'pending', v_thread_id LIKE 'app_pending_%'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION app_create_sms_session(uuid) TO authenticated;
