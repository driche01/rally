-- ============================================================
-- Migration 094: set_planner_for_phone RPC
--
-- Phase 15.1 — fixes the "Edit rally" planner toggle.
--
-- Problem: the toggle in GroupSection only updated
-- `respondents.is_planner`, but the PLANNER pill renders from
-- `trip_session_participants.is_planner`. The two columns weren't
-- kept in sync, so toggling appeared to do nothing. Worse, the toggle
-- was gated on a respondent row existing, which excluded any contact
-- added directly to the trip without going through the survey first.
--
-- This RPC takes a phone (the canonical identity on a trip — same
-- value used by member-add/member-remove) and flips is_planner on
-- both tables in one transaction. The trip creator is always a
-- planner — attempts to demote them are rejected.
--
-- Authorization: caller must be the trip's created_by OR the SMS-side
-- planner of the live session (matches app_add_trip_contacts).
-- ============================================================

CREATE OR REPLACE FUNCTION set_planner_for_phone(
  p_trip_id    uuid,
  p_phone      text,
  p_is_planner boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid              uuid;
  v_caller_users_id  uuid;
  v_session_id       uuid;
  v_session_planner  uuid;
  v_authorized       boolean := false;
  v_normalized_phone text;
  v_creator          uuid;
  v_creator_phone    text;
  v_resp_updated     int := 0;
  v_part_updated     int := 0;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  v_normalized_phone := normalize_phone(p_phone);
  IF v_normalized_phone IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_phone');
  END IF;

  -- ─── Authorize: caller must be planner of this trip ──────────────────
  SELECT created_by INTO v_creator FROM trips WHERE id = p_trip_id;
  IF v_creator IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'trip_not_found');
  END IF;

  SELECT id INTO v_caller_users_id FROM users WHERE auth_user_id = v_uid LIMIT 1;

  SELECT id, planner_user_id
  INTO   v_session_id, v_session_planner
  FROM   trip_sessions
  WHERE  trip_id = p_trip_id
    AND  status IN ('ACTIVE', 'PAUSED', 'RE_ENGAGEMENT_PENDING', 'FIRST_BOOKING_REACHED')
  ORDER BY created_at DESC
  LIMIT  1;

  IF v_caller_users_id IS NOT NULL AND v_caller_users_id = v_session_planner THEN
    v_authorized := true;
  ELSIF v_creator = v_uid THEN
    v_authorized := true;
  END IF;

  IF NOT v_authorized THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  -- ─── Protect the creator from being demoted ──────────────────────────
  -- The creator's identity on the SMS side is users.phone for the row
  -- linked to their auth user. Demoting that row would leave the trip
  -- without an authoritative planner.
  IF NOT p_is_planner THEN
    SELECT u.phone INTO v_creator_phone
    FROM users u
    WHERE u.auth_user_id = v_creator
    LIMIT 1;

    IF v_creator_phone IS NOT NULL AND v_creator_phone = v_normalized_phone THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'cannot_demote_creator');
    END IF;
  END IF;

  -- ─── Update respondents (best-effort — row may not exist) ────────────
  UPDATE respondents
  SET    is_planner = p_is_planner
  WHERE  trip_id = p_trip_id
    AND  phone   = v_normalized_phone;
  GET DIAGNOSTICS v_resp_updated = ROW_COUNT;

  -- ─── Update participant (best-effort — row may not exist) ────────────
  IF v_session_id IS NOT NULL THEN
    UPDATE trip_session_participants
    SET    is_planner = p_is_planner,
           updated_at = now()
    WHERE  trip_session_id = v_session_id
      AND  phone           = v_normalized_phone;
    GET DIAGNOSTICS v_part_updated = ROW_COUNT;
  END IF;

  IF v_resp_updated = 0 AND v_part_updated = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'phone_not_on_trip');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'respondent_updated',  v_resp_updated > 0,
    'participant_updated', v_part_updated > 0
  );
END;
$$;

GRANT EXECUTE ON FUNCTION set_planner_for_phone(uuid, text, boolean) TO authenticated;

COMMENT ON FUNCTION set_planner_for_phone(uuid, text, boolean) IS
  'Phase 15.1 — flip is_planner on both respondents and trip_session_participants by phone. Caller must be the trip planner. The trip creator cannot be demoted.';
