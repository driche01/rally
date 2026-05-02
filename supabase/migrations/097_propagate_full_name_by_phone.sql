-- ============================================================
-- Migration 097: match respondents by phone, not user_id
--
-- 096 keyed the respondents.name backfill on respondents.user_id, but
-- member-add (the path most planners go through) doesn't populate
-- respondents.user_id — that column is only set by the SMS-side
-- handshake. So the backfill silently skipped the planner's own row,
-- and the trip-card subhead kept rendering "d r".
--
-- Phone is the canonical cross-table identity in Rally. Re-do the
-- backfill matching `respondents.phone = users.phone` (with
-- normalize_phone for safety) and update the sync RPC to do the same
-- so future Edit-name saves cover member-add'd planners too.
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
  v_user_phone   text;
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

  SELECT id, phone INTO v_users_id, v_user_phone
  FROM   users WHERE auth_user_id = v_uid LIMIT 1;
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
  WHERE  user_id = v_users_id
     OR  (v_user_phone IS NOT NULL AND normalize_phone(phone) = v_user_phone);
  GET DIAGNOSTICS v_part_count = ROW_COUNT;

  -- Match respondents both ways: explicit user_id link (rare — only set
  -- by the SMS handshake) AND phone match (covers member-add rows where
  -- user_id is null).
  UPDATE respondents
  SET    name = v_full_name
  WHERE  user_id = v_users_id
     OR  (v_user_phone IS NOT NULL AND normalize_phone(phone) = v_user_phone);
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


-- ─── Re-run backfill, this time keyed on phone ─────────────────────────
-- For every user with a linked auth account, propagate their composed
-- profile name to every respondents row that shares their normalized
-- phone — regardless of whether respondents.user_id was ever wired up.
WITH composed AS (
  SELECT u.phone AS phone,
         nullif(trim(coalesce(p.name, '') || ' ' || coalesce(p.last_name, '')), '') AS full_name
  FROM   users u
  JOIN   profiles p ON p.id = u.auth_user_id
  WHERE  u.auth_user_id IS NOT NULL
    AND  u.phone IS NOT NULL
)
UPDATE respondents r
SET    name = c.full_name
FROM   composed c
WHERE  normalize_phone(r.phone) = c.phone
  AND  c.full_name IS NOT NULL;

-- And same for trip_session_participants — 095 keyed on user_id, but if
-- the participant row predates the users<->auth link, it would have been
-- skipped. Phone match catches it.
WITH composed AS (
  SELECT u.phone AS phone,
         nullif(trim(coalesce(p.name, '') || ' ' || coalesce(p.last_name, '')), '') AS full_name
  FROM   users u
  JOIN   profiles p ON p.id = u.auth_user_id
  WHERE  u.auth_user_id IS NOT NULL
    AND  u.phone IS NOT NULL
)
UPDATE trip_session_participants tsp
SET    display_name = c.full_name,
       updated_at   = now()
FROM   composed c
WHERE  normalize_phone(tsp.phone) = c.phone
  AND  c.full_name IS NOT NULL;
