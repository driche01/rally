-- ============================================================
-- Migration 040: Group Dashboard RLS + planner-only RPC
--
-- Phase 4 of the 1:1 SMS pivot. Opens read access to trip_sessions
-- and trip_session_participants for authenticated users who are
-- trip_members of the underlying trip. Adds remove_session_participant
-- so the dashboard's swipe-to-remove flows through a planner-gated
-- SECURITY DEFINER path instead of needing row-level write policies.
--
-- thread_messages stays locked (privacy — each participant's 1:1
-- thread is theirs, not the planner's). trip_session_events stays
-- locked until we have a UI for it.
--
-- Idempotent.
-- ============================================================


-- ─── 1. trip_sessions: trip members can read ───────────────────────────────
DO $$ BEGIN
  CREATE POLICY "trip_sessions_member_read" ON trip_sessions
    FOR SELECT TO authenticated USING (
      trip_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM trip_members tm
        WHERE tm.trip_id = trip_sessions.trip_id
          AND tm.user_id = auth.uid()
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ─── 2. trip_session_participants: trip members can read ───────────────────
DO $$ BEGIN
  CREATE POLICY "trip_session_participants_member_read" ON trip_session_participants
    FOR SELECT TO authenticated USING (
      EXISTS (
        SELECT 1 FROM trip_sessions ts
        JOIN trip_members tm ON tm.trip_id = ts.trip_id
        WHERE ts.id = trip_session_participants.trip_session_id
          AND tm.user_id = auth.uid()
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ─── 3. remove_session_participant RPC ──────────────────────────────────────
-- Soft-removes a participant. Caller must be the planner of the underlying
-- trip session (matched via users.auth_user_id ↔ trip_sessions.planner_user_id)
-- OR a trip_member with the trip's created_by relationship. Keeps the row
-- so message history stays intact; just sets status='removed_by_planner'.

CREATE OR REPLACE FUNCTION remove_session_participant(p_participant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid                uuid;
  v_participant        trip_session_participants%ROWTYPE;
  v_session            trip_sessions%ROWTYPE;
  v_caller_users_id    uuid;
  v_authorized         boolean := false;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  SELECT * INTO v_participant FROM trip_session_participants WHERE id = p_participant_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  SELECT * INTO v_session FROM trip_sessions WHERE id = v_participant.trip_session_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'session_missing');
  END IF;

  -- Authorize: caller must be the SMS-side planner OR the trip's created_by.
  SELECT id INTO v_caller_users_id FROM users WHERE auth_user_id = v_uid LIMIT 1;
  IF v_caller_users_id IS NOT NULL AND v_caller_users_id = v_session.planner_user_id THEN
    v_authorized := true;
  ELSIF v_session.trip_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM trips t
      WHERE  t.id = v_session.trip_id AND t.created_by = v_uid
    ) INTO v_authorized;
  END IF;

  IF NOT v_authorized THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  -- Don't let a planner remove themselves via this path; transfer first.
  IF v_participant.user_id IS NOT NULL AND v_participant.user_id = v_session.planner_user_id THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'planner_must_transfer_first');
  END IF;

  UPDATE trip_session_participants
  SET    status = 'removed_by_planner', updated_at = now()
  WHERE  id = p_participant_id;

  RETURN jsonb_build_object('ok', true, 'participant_id', p_participant_id);
END;
$$;

GRANT EXECUTE ON FUNCTION remove_session_participant(uuid) TO authenticated;
