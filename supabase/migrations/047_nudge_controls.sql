-- ============================================================
-- Migration 047: Planner cadence controls
--
-- RPCs the dashboard cadence card calls when the planner wants to
-- override the autonomous nudge schedule. Each is SECURITY DEFINER and
-- gates on trip_membership — only members of the trip can mutate the
-- nudge schedule, even though the underlying nudge_sends table is
-- otherwise service-role write-only.
--
--   send_nudge_now           — push next pending nudge for a session/
--                              participant to scheduled_for = now()
--   skip_next_nudge          — mark the next pending nudge as skipped
--   pause_participant_nudges — mark ALL pending nudges for a participant
--                              as skipped (planner pause)
-- ============================================================


-- ─── 1. send_nudge_now ─────────────────────────────────────────────────────
-- If p_participant_id is NULL, finds the soonest-pending nudge across
-- all session participants. Returns the row id that was bumped (or
-- 'no_pending' if there's nothing to send).

CREATE OR REPLACE FUNCTION send_nudge_now(
  p_trip_session_id uuid,
  p_participant_id  uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid          uuid;
  v_authorized   boolean;
  v_row_id       uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM trip_sessions ts
    JOIN trip_members tm ON tm.trip_id = ts.trip_id
    WHERE ts.id = p_trip_session_id AND tm.user_id = v_uid
  ) INTO v_authorized;

  IF NOT v_authorized THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  SELECT id INTO v_row_id
  FROM nudge_sends
  WHERE trip_session_id = p_trip_session_id
    AND sent_at IS NULL
    AND skipped_at IS NULL
    AND (p_participant_id IS NULL OR participant_id = p_participant_id)
  ORDER BY scheduled_for ASC
  LIMIT 1
  FOR UPDATE;

  IF v_row_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_pending');
  END IF;

  UPDATE nudge_sends
  SET scheduled_for = now()
  WHERE id = v_row_id;

  RETURN jsonb_build_object('ok', true, 'nudge_id', v_row_id);
END;
$$;

GRANT EXECUTE ON FUNCTION send_nudge_now(uuid, uuid) TO authenticated;


-- ─── 2. skip_next_nudge ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION skip_next_nudge(
  p_trip_session_id uuid,
  p_participant_id  uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid         uuid;
  v_authorized  boolean;
  v_row_id      uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM trip_sessions ts
    JOIN trip_members tm ON tm.trip_id = ts.trip_id
    WHERE ts.id = p_trip_session_id AND tm.user_id = v_uid
  ) INTO v_authorized;

  IF NOT v_authorized THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  SELECT id INTO v_row_id
  FROM nudge_sends
  WHERE trip_session_id = p_trip_session_id
    AND sent_at IS NULL
    AND skipped_at IS NULL
    AND (p_participant_id IS NULL OR participant_id = p_participant_id)
  ORDER BY scheduled_for ASC
  LIMIT 1
  FOR UPDATE;

  IF v_row_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_pending');
  END IF;

  UPDATE nudge_sends
  SET skipped_at = now(),
      skip_reason = 'planner_skipped'
  WHERE id = v_row_id;

  RETURN jsonb_build_object('ok', true, 'nudge_id', v_row_id);
END;
$$;

GRANT EXECUTE ON FUNCTION skip_next_nudge(uuid, uuid) TO authenticated;


-- ─── 3. pause_participant_nudges ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION pause_participant_nudges(
  p_trip_session_id uuid,
  p_participant_id  uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid         uuid;
  v_authorized  boolean;
  v_count       int;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM trip_sessions ts
    JOIN trip_members tm ON tm.trip_id = ts.trip_id
    WHERE ts.id = p_trip_session_id AND tm.user_id = v_uid
  ) INTO v_authorized;

  IF NOT v_authorized THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  WITH paused AS (
    UPDATE nudge_sends
    SET skipped_at = now(),
        skip_reason = 'planner_paused'
    WHERE trip_session_id = p_trip_session_id
      AND participant_id = p_participant_id
      AND sent_at IS NULL
      AND skipped_at IS NULL
    RETURNING id
  )
  SELECT count(*) INTO v_count FROM paused;

  RETURN jsonb_build_object('ok', true, 'count', v_count);
END;
$$;

GRANT EXECUTE ON FUNCTION pause_participant_nudges(uuid, uuid) TO authenticated;
