-- ============================================================
-- Migration 045: Planner inbox — surface inbound participant SMS
--
-- Under the post-pivot model, Rally no longer holds open conversations
-- with participants. Inbound SMS gets a soft auto-redirect (see
-- supabase/functions/_sms-shared/inbound-processor.ts). But the planner
-- still needs to *see* what the participant said — otherwise messages
-- that need follow-up (logistics asks, can't-make-it heads-ups,
-- one-off questions) silently disappear into the redirect.
--
-- This migration adds:
--   thread_messages.needs_planner_attention
--   thread_messages.planner_acknowledged_at
--   thread_messages.planner_acknowledged_by
--   ack_planner_inbox_message()  RPC
--   ack_planner_inbox_for_trip() RPC
--
-- Idempotent.
-- ============================================================


-- ─── 1. Columns ──────────────────────────────────────────────────────────────

ALTER TABLE thread_messages
  ADD COLUMN IF NOT EXISTS needs_planner_attention boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS planner_acknowledged_at timestamptz,
  ADD COLUMN IF NOT EXISTS planner_acknowledged_by uuid REFERENCES users(id);

-- Hot path: dashboard "recent inbound" card per trip
CREATE INDEX IF NOT EXISTS idx_thread_messages_inbox_per_session
  ON thread_messages(trip_session_id, created_at DESC)
  WHERE needs_planner_attention = true AND planner_acknowledged_at IS NULL;


-- ─── 2. ack_planner_inbox_message — single-message ack ──────────────────────
-- Caller is an authenticated planner. Marks one inbound message as seen so
-- it drops out of the unread badge but stays visible in the timeline.

CREATE OR REPLACE FUNCTION ack_planner_inbox_message(p_message_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid          uuid;
  v_users_id     uuid;
  v_authorized   boolean := false;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  SELECT id INTO v_users_id FROM users WHERE auth_user_id = v_uid LIMIT 1;

  -- Authorize: caller must be a trip_member of the message's trip session.
  SELECT EXISTS (
    SELECT 1
    FROM thread_messages tm
    JOIN trip_sessions ts ON ts.id = tm.trip_session_id
    JOIN trip_members tmb ON tmb.trip_id = ts.trip_id
    WHERE tm.id = p_message_id
      AND tmb.user_id = v_uid
  ) INTO v_authorized;

  IF NOT v_authorized THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  UPDATE thread_messages
  SET    planner_acknowledged_at = now(),
         planner_acknowledged_by = v_users_id
  WHERE  id = p_message_id
    AND  planner_acknowledged_at IS NULL;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION ack_planner_inbox_message(uuid) TO authenticated;


-- ─── 3. ack_planner_inbox_for_trip — bulk ack ───────────────────────────────
-- Marks every unread inbox item for a trip as acknowledged. Wired to
-- "open the inbox" — viewing the section clears the badge.

CREATE OR REPLACE FUNCTION ack_planner_inbox_for_trip(p_trip_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid         uuid;
  v_users_id    uuid;
  v_authorized  boolean;
  v_count       int;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  SELECT id INTO v_users_id FROM users WHERE auth_user_id = v_uid LIMIT 1;

  SELECT EXISTS (
    SELECT 1 FROM trip_members
    WHERE trip_id = p_trip_id AND user_id = v_uid
  ) INTO v_authorized;

  IF NOT v_authorized THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  WITH updated AS (
    UPDATE thread_messages tm
    SET    planner_acknowledged_at = now(),
           planner_acknowledged_by = v_users_id
    FROM   trip_sessions ts
    WHERE  tm.trip_session_id = ts.id
      AND  ts.trip_id = p_trip_id
      AND  tm.needs_planner_attention = true
      AND  tm.planner_acknowledged_at IS NULL
    RETURNING tm.id
  )
  SELECT count(*) INTO v_count FROM updated;

  RETURN jsonb_build_object('ok', true, 'count', v_count);
END;
$$;

GRANT EXECUTE ON FUNCTION ack_planner_inbox_for_trip(uuid) TO authenticated;


-- ─── 4. resolve_inbound_for_planner — RPC the inbound edge fn calls ─────────
-- Service-role only. Takes a sender phone, returns the active trip session(s)
-- and planner contact info Rally needs to (a) tag the redirect message with
-- the planner's name, (b) attach trip_session_id to the thread_message row,
-- and (c) deliver a push notification to the planner's devices.
--
-- A phone may be in multiple active sessions (rare but possible). Returns
-- an array of matches; the caller fans out the notification to each.

CREATE OR REPLACE FUNCTION resolve_inbound_for_planner(p_phone text)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_phone   text;
  v_rows    jsonb;
BEGIN
  v_phone := normalize_phone(p_phone);
  IF v_phone IS NULL THEN
    RETURN jsonb_build_object('matches', '[]'::jsonb);
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'trip_session_id', ts.id,
    'trip_id',         ts.trip_id,
    'participant_id',  p.id,
    'participant_name', p.display_name,
    'planner_user_id', ts.planner_user_id,
    'planner_name',    pu.display_name
  )), '[]'::jsonb) INTO v_rows
  FROM trip_session_participants p
  JOIN trip_sessions ts ON ts.id = p.trip_session_id
  LEFT JOIN users pu     ON pu.id = ts.planner_user_id
  WHERE p.phone = v_phone
    AND p.status = 'active'
    AND ts.status IN ('ACTIVE', 'PAUSED', 'RE_ENGAGEMENT_PENDING');

  RETURN jsonb_build_object('matches', v_rows);
END;
$$;
-- No GRANT — service role only.
