-- ============================================================
-- Migration 095: propagate full first+last name to planner identities
--
-- Problem: the planner row on a trip's roster ("Edit rally" → Who's
-- invited?) showed just the first name — and worse, never refreshed
-- after the user updated their account name. Trips created when the
-- profile name was a placeholder (e.g. "d") stayed stuck on that
-- placeholder forever.
--
-- Root cause: app_create_sms_session copied trip_session_participants
-- .display_name from users.display_name, which itself was seeded once
-- from profiles.name (first name only) and never written again.
--
-- This migration:
--   1. Replaces app_create_sms_session so it pulls the composed
--      first+last name from profiles for both users.display_name
--      (when a row is created/linked) and the planner participant.
--   2. Adds app_sync_my_display_name() — an RPC the app calls after
--      the Edit name modal saves so users.display_name + every
--      trip_session_participants row tied to that user re-sync.
--   3. Backfills users.display_name + trip_session_participants
--      .display_name for every user who has a linked auth account,
--      so trips created before today pick up the fix.
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
  v_full_name        text;
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

  -- Composed first+last name. Empty string collapses to NULL so
  -- every downstream COALESCE works.
  SELECT nullif(trim(coalesce(name, '') || ' ' || coalesce(last_name, '')), '')
  INTO   v_full_name
  FROM   profiles WHERE id = v_uid;

  -- ─── Resolve planner_user_id, best-effort ────────────────────────────
  SELECT id INTO v_users_id FROM users WHERE auth_user_id = v_uid LIMIT 1;

  IF v_users_id IS NULL THEN
    SELECT phone INTO v_candidate_phone FROM profiles WHERE id = v_uid;
    IF nullif(v_candidate_phone, '') IS NULL THEN
      SELECT nullif(phone, '') INTO v_candidate_phone FROM auth.users WHERE id = v_uid;
    END IF;

    v_normalized_phone := normalize_phone(v_candidate_phone);

    IF v_normalized_phone IS NOT NULL THEN
      SELECT id INTO v_users_id FROM users WHERE phone = v_normalized_phone;
      IF v_users_id IS NULL THEN
        INSERT INTO users (phone, display_name, rally_account, auth_user_id)
        VALUES (v_normalized_phone, v_full_name, true, v_uid)
        RETURNING id INTO v_users_id;
      ELSE
        UPDATE users
        SET    auth_user_id = v_uid,
               rally_account = true,
               display_name  = COALESCE(v_full_name, display_name)
        WHERE  id = v_users_id AND auth_user_id IS NULL;
      END IF;
    END IF;
  END IF;

  -- Resync users.display_name from the current profile. This is the
  -- back-prop that was missing in 080 — without it, a profile rename
  -- never reached the SMS-side identity.
  IF v_users_id IS NOT NULL AND v_full_name IS NOT NULL THEN
    UPDATE users SET display_name = v_full_name WHERE id = v_users_id;
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
    UPDATE trip_sessions
    SET    planner_user_id = v_users_id
    WHERE  id = v_session_id AND planner_user_id IS NULL;
  END IF;

  -- ─── Planner participant — only if we have a phone for them ─────────
  -- ON CONFLICT also rewrites display_name so an existing row picks up
  -- the latest profile name on every session-create call.
  IF v_users_id IS NOT NULL THEN
    INSERT INTO trip_session_participants (
      trip_session_id, user_id, phone, display_name, status, is_planner
    )
    SELECT v_session_id,
           v_users_id,
           u.phone,
           COALESCE(v_full_name, u.display_name),
           'active',
           true
    FROM   users u
    WHERE  u.id = v_users_id
    ON CONFLICT (trip_session_id, phone) DO UPDATE
      SET is_planner   = true,
          display_name = COALESCE(EXCLUDED.display_name, trip_session_participants.display_name),
          updated_at   = now();
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


-- ─── New RPC: app_sync_my_display_name() ─────────────────────────────────
-- Called from the Account → Edit name modal so the new full name
-- propagates to users.display_name + every trip_session_participants
-- row tied to that user. Without this, edits only touched profiles.*
-- and never reached the SMS-side identity.
CREATE OR REPLACE FUNCTION app_sync_my_display_name()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid          uuid;
  v_users_id     uuid;
  v_full_name    text;
  v_users_count  int := 0;
  v_part_count   int := 0;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  SELECT nullif(trim(coalesce(name, '') || ' ' || coalesce(last_name, '')), '')
  INTO   v_full_name
  FROM   profiles WHERE id = v_uid;

  IF v_full_name IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'profile_name_empty');
  END IF;

  SELECT id INTO v_users_id FROM users WHERE auth_user_id = v_uid LIMIT 1;
  IF v_users_id IS NULL THEN
    -- No phone-side identity — nothing to sync, not an error.
    RETURN jsonb_build_object('ok', true, 'users_updated', 0, 'participants_updated', 0);
  END IF;

  UPDATE users
  SET    display_name = v_full_name
  WHERE  id = v_users_id;
  GET DIAGNOSTICS v_users_count = ROW_COUNT;

  UPDATE trip_session_participants
  SET    display_name = v_full_name,
         updated_at   = now()
  WHERE  user_id = v_users_id;
  GET DIAGNOSTICS v_part_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'users_updated', v_users_count,
    'participants_updated', v_part_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION app_sync_my_display_name() TO authenticated;

COMMENT ON FUNCTION app_sync_my_display_name() IS
  'Propagate the caller''s profiles.{name,last_name} to users.display_name and every trip_session_participants.display_name row tied to that user. Called from the account Edit name modal.';


-- ─── Backfill ────────────────────────────────────────────────────────────
-- For every user with a linked auth account, recompute display_name from
-- their current profile and propagate to existing participants. Pure SMS
-- contacts (no auth_user_id) are left alone — those names came directly
-- from the AddPersonModal and are already first+last.
WITH composed AS (
  SELECT u.id AS user_id,
         nullif(trim(coalesce(p.name, '') || ' ' || coalesce(p.last_name, '')), '') AS full_name
  FROM   users u
  JOIN   profiles p ON p.id = u.auth_user_id
  WHERE  u.auth_user_id IS NOT NULL
)
UPDATE users u
SET    display_name = c.full_name
FROM   composed c
WHERE  u.id = c.user_id
  AND  c.full_name IS NOT NULL;

WITH composed AS (
  SELECT u.id AS user_id,
         nullif(trim(coalesce(p.name, '') || ' ' || coalesce(p.last_name, '')), '') AS full_name
  FROM   users u
  JOIN   profiles p ON p.id = u.auth_user_id
  WHERE  u.auth_user_id IS NOT NULL
)
UPDATE trip_session_participants tsp
SET    display_name = c.full_name,
       updated_at   = now()
FROM   composed c
WHERE  tsp.user_id = c.user_id
  AND  c.full_name IS NOT NULL;
