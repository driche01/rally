-- ============================================================
-- Migration 106: delete_account_data clears every users(id) ref
--
-- Two FK columns introduced in migration 026 reference users(id)
-- without an ON DELETE clause, so they default to NO ACTION /
-- RESTRICT — and the delete_account_data RPC didn't know about them:
--
--   * booking_signals.user_id        — monetization instrumentation
--   * user_preferences.user_id       — personalization layer
--
-- For any account that's accumulated rows in either table (typical
-- after a few test bookings or any traveler-prefs save that wrote
-- to user_preferences), the final DELETE FROM users in the cleanup
-- RPC fails with "update or delete on table 'users' violates foreign
-- key constraint" and the planner sees `cleanup_failed` with no path
-- forward. This migration:
--
--   1. Adds DELETE statements for both tables to delete_account_data
--      so the user-row deletion has nothing dangling to block it.
--   2. Re-declares both FKs with ON DELETE CASCADE so future schema
--      drift can't reintroduce the same gap. CASCADE is the right
--      semantics here — both rows are caller-owned and meaningless
--      once the user is gone.
-- ============================================================


-- ─── 1. Patch delete_account_data ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION delete_account_data()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid          uuid;
  v_session_ids  uuid[];
  v_users_ids    uuid[];
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  -- Trip sessions for trips this user created. Need to clear before the
  -- trip cascade hits them (NO ACTION FK).
  SELECT array_agg(ts.id) INTO v_session_ids
  FROM   trip_sessions ts
  JOIN   trips t ON t.id = ts.trip_id
  WHERE  t.created_by = v_uid;

  IF v_session_ids IS NOT NULL THEN
    DELETE FROM thread_messages
    WHERE  trip_session_id = ANY(v_session_ids);

    UPDATE polls
    SET    trip_session_id = NULL
    WHERE  trip_session_id = ANY(v_session_ids);

    UPDATE trip_sessions
    SET    parent_session_id = NULL, child_session_id = NULL
    WHERE  id = ANY(v_session_ids);

    DELETE FROM trip_sessions
    WHERE  id = ANY(v_session_ids);
  END IF;

  -- expense_splits has a CHECK constraint requiring exactly one of
  -- (split_planner_id, split_respondent_id). The FK action is SET NULL,
  -- so a planner-side cascade would violate the check. Delete outright.
  DELETE FROM expense_splits WHERE split_planner_id = v_uid;

  -- public.users rows for this auth user (typically one). NULL out
  -- references from other people's data so the row can be deleted.
  SELECT array_agg(id) INTO v_users_ids
  FROM   users WHERE auth_user_id = v_uid;

  IF v_users_ids IS NOT NULL THEN
    UPDATE poll_recommendations
    SET    planner_action_by = NULL
    WHERE  planner_action_by = ANY(v_users_ids);

    UPDATE respondents
    SET    user_id = NULL
    WHERE  user_id = ANY(v_users_ids);

    UPDATE thread_messages
    SET    planner_acknowledged_by = NULL
    WHERE  planner_acknowledged_by = ANY(v_users_ids);

    UPDATE trip_session_participants
    SET    user_id = NULL
    WHERE  user_id = ANY(v_users_ids);

    -- New (migration 106): tables whose FKs to users(id) default to
    -- NO ACTION. Without these deletes the final DELETE FROM users
    -- below fails with a foreign-key violation.
    DELETE FROM booking_signals
    WHERE  user_id = ANY(v_users_ids);

    DELETE FROM user_preferences
    WHERE  user_id = ANY(v_users_ids);

    DELETE FROM users WHERE id = ANY(v_users_ids);
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION delete_account_data() TO authenticated;


-- ─── 2. Backstop: switch both FKs to ON DELETE CASCADE ────────────────────────
-- CASCADE is the right semantics — both row sets are owned by the user
-- and have no meaning once the user is gone. Doing this at the FK level
-- means future code paths that DELETE from users (the cleanup RPC, an
-- admin tool, anything else) don't need to remember these tables.
DO $$ BEGIN
  IF to_regclass('public.booking_signals') IS NOT NULL THEN
    ALTER TABLE booking_signals DROP CONSTRAINT IF EXISTS booking_signals_user_id_fkey;
    ALTER TABLE booking_signals
      ADD CONSTRAINT booking_signals_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
  END IF;

  IF to_regclass('public.user_preferences') IS NOT NULL THEN
    ALTER TABLE user_preferences DROP CONSTRAINT IF EXISTS user_preferences_user_id_fkey;
    ALTER TABLE user_preferences
      ADD CONSTRAINT user_preferences_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
  END IF;
END $$;
