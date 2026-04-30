-- App-data cleanup for account deletion.
--
-- The auth.users row itself can only be deleted via the auth admin API
-- (service role), which lives in the delete-account edge function.
-- This RPC handles all the public-schema cleanup that has to happen
-- *before* auth.users is deleted, so the cascade through profiles →
-- trips doesn't trip over NO ACTION FKs (trip_sessions, expense_splits
-- check constraint, cross-user references to public.users).
--
-- Runs as SECURITY DEFINER so it can write across tables, but auth.uid()
-- still resolves to the calling user — the RPC always operates on the
-- caller's own data.

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
    UPDATE join_links
    SET    created_by_user_id = NULL
    WHERE  created_by_user_id = ANY(v_users_ids);

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

    DELETE FROM users WHERE id = ANY(v_users_ids);
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION delete_account_data() TO authenticated;
