-- ============================================================
-- Migration 096: extend full-name propagation to respondents.name
--
-- 095 fixed users.display_name and trip_session_participants.display_name,
-- but the trip-detail hero subhead ("X, Y and Z are all in") and the
-- live-results / planner-side rosters all read from `respondents.name`.
-- That column was set once at member-add or survey-submit time and
-- never refreshed when the planner edited their account name — so
-- trips kept showing stale fragments like "d r" even after their
-- profile said "David Riche".
--
-- This migration:
--   1. Extends app_sync_my_display_name() to also rewrite
--      respondents.name for every row whose user_id points back at the
--      caller (joined via users.auth_user_id).
--   2. One-shot backfills respondents.name from profiles for every
--      authed user across every trip they're on.
-- ============================================================

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
  v_resp_count   int := 0;
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
    RETURN jsonb_build_object('ok', true, 'users_updated', 0, 'participants_updated', 0, 'respondents_updated', 0);
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

  UPDATE respondents
  SET    name = v_full_name
  WHERE  user_id = v_users_id;
  GET DIAGNOSTICS v_resp_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'users_updated', v_users_count,
    'participants_updated', v_part_count,
    'respondents_updated', v_resp_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION app_sync_my_display_name() TO authenticated;

COMMENT ON FUNCTION app_sync_my_display_name() IS
  'Propagate the caller''s profiles.{name,last_name} to users.display_name, every trip_session_participants.display_name row, and every respondents.name row tied to that user. Called from the account Edit name modal.';


-- ─── Backfill respondents.name ──────────────────────────────────────────
-- Mirror of 095''s backfill for the new third table. Rows whose user_id
-- maps to a users row with a linked auth account get their name reset to
-- the composed profile name. SMS-only contacts (no auth_user_id on users)
-- are left alone — their respondents.name came from the planner''s
-- AddPersonModal and is already first+last.
WITH composed AS (
  SELECT u.id AS user_id,
         nullif(trim(coalesce(p.name, '') || ' ' || coalesce(p.last_name, '')), '') AS full_name
  FROM   users u
  JOIN   profiles p ON p.id = u.auth_user_id
  WHERE  u.auth_user_id IS NOT NULL
)
UPDATE respondents r
SET    name = c.full_name
FROM   composed c
WHERE  r.user_id = c.user_id
  AND  c.full_name IS NOT NULL;
