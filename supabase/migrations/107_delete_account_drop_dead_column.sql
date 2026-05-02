-- ============================================================
-- Migration 107: delete_account_data drops the planner-inbox UPDATE
--
-- Migration 088 retired the planner-inbox feature and dropped three
-- columns from thread_messages, including planner_acknowledged_by.
-- delete_account_data was carried forward unchanged across 079 and
-- 106, still referencing the dropped column — so any account with
-- thread_messages rows (every active account) hits a Postgres
-- "column does not exist" error mid-cleanup and the planner sees
-- `cleanup_failed — column "planner_acknowledged_by" does not exist`.
--
-- This migration removes the dead UPDATE. The rest of the function
-- body matches migration 106 (booking_signals + user_preferences
-- deletes already in place).
-- ============================================================

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

  DELETE FROM expense_splits WHERE split_planner_id = v_uid;

  SELECT array_agg(id) INTO v_users_ids
  FROM   users WHERE auth_user_id = v_uid;

  IF v_users_ids IS NOT NULL THEN
    UPDATE poll_recommendations
    SET    planner_action_by = NULL
    WHERE  planner_action_by = ANY(v_users_ids);

    UPDATE respondents
    SET    user_id = NULL
    WHERE  user_id = ANY(v_users_ids);

    -- (planner_acknowledged_by UPDATE removed — column dropped in 088.)

    UPDATE trip_session_participants
    SET    user_id = NULL
    WHERE  user_id = ANY(v_users_ids);

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
