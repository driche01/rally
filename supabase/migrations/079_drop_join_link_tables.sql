-- ============================================================
-- Migration 079: Drop the /join/[code] handshake flow
--
-- Phase 1 of the 1:1 SMS pivot used a public form at /join/[code]: the
-- planner shared the link, the recipient filled in name + phone, replied
-- YES to the confirmation SMS, and was promoted to an active SMS
-- participant. That whole flow is retired — the planner now adds members
-- directly via the trip-edit / Group Dashboard, and the welcome SMS
-- includes the survey link without any YES/NO handshake.
--
-- This migration:
--   1. Re-creates `delete_account_data()` without the join_links UPDATE
--      (otherwise the RPC would fail once join_links is dropped).
--   2. Drops the four join-link RPCs.
--   3. Drops `join_link_submissions` (FK to join_links cascades).
--   4. Drops `join_links`.
--
-- Code-side companion changes already shipped: removal of /app/join/,
-- src/lib/api/joinLink.ts, supabase/functions/sms-join-submit/, the
-- join-intent helper, the join templates, and the inbound-processor
-- YES/NO branch.
-- ============================================================

-- ─── 1. Update delete_account_data — drop the join_links reference ──────
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
    -- (join_links UPDATE removed — table dropped in this migration.)

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


-- ─── 2. Drop the join-link RPCs ─────────────────────────────────────────
-- Each is dropped IF EXISTS so the migration is safe to re-run on a
-- database that already had them dropped manually.
DROP FUNCTION IF EXISTS submit_join_link(text, text, text, text, text);
DROP FUNCTION IF EXISTS get_join_link_preview(text);
DROP FUNCTION IF EXISTS confirm_join_submission(text, text);
DROP FUNCTION IF EXISTS create_join_link(uuid);


-- ─── 3. Drop the tables ─────────────────────────────────────────────────
-- join_link_submissions has ON DELETE CASCADE on its FK to join_links,
-- so dropping submissions first is purely about being explicit. CASCADE
-- on the parent drop would clean it up automatically.
DROP TABLE IF EXISTS join_link_submissions;
DROP TABLE IF EXISTS join_links;
