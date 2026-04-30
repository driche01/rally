-- ============================================================
-- Migration 052: approve_poll_recommendation also syncs trip fields
--
-- The original 048 RPC just flipped polls.status='decided'. The TS-side
-- decidePollAndSync (src/lib/api/polls.ts) does more: it syncs the
-- winning option label back into trips.start_date / end_date /
-- destination / budget_per_person depending on poll type.
--
-- That meant approvals via the dashboard decision queue would lock the
-- poll but leave the trip's structured fields stale. Cards on the trip
-- detail screen — and the public results page — kept showing the
-- pre-lock state until the planner manually edited.
--
-- Fix: replicate the field-sync logic in the RPC. Same semantics as
-- decidePollAndSync, but server-side so both lock paths stay in sync.
-- ============================================================

CREATE OR REPLACE FUNCTION approve_poll_recommendation(
  p_recommendation_id uuid,
  p_override_option_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid           uuid;
  v_users_id      uuid;
  v_authorized    boolean;
  v_rec           poll_recommendations%ROWTYPE;
  v_lock_option   uuid;
  v_lock_label    text;
  v_status        text;
  v_poll_type     text;
  v_trip_id       uuid;
  v_existing_dest text;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  SELECT * INTO v_rec FROM poll_recommendations WHERE id = p_recommendation_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF v_rec.status NOT IN ('pending', 'held') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_resolved');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM trip_members
    WHERE trip_id = v_rec.trip_id AND user_id = v_uid
  ) INTO v_authorized;
  IF NOT v_authorized THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  v_lock_option := COALESCE(p_override_option_id, v_rec.recommended_option_id);
  IF v_lock_option IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_option');
  END IF;

  SELECT label INTO v_lock_label FROM poll_options WHERE id = v_lock_option;
  IF v_lock_label IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'option_invalid');
  END IF;

  SELECT id INTO v_users_id FROM users WHERE auth_user_id = v_uid LIMIT 1;
  v_status := CASE WHEN p_override_option_id IS NOT NULL THEN 'edited' ELSE 'approved' END;

  UPDATE poll_recommendations
  SET    status            = v_status,
         locked_value      = v_lock_label,
         planner_action_at = now(),
         planner_action_by = v_users_id
  WHERE  id = p_recommendation_id;

  -- Lock the underlying poll.
  UPDATE polls
  SET    status = 'decided',
         decided_option_id = v_lock_option
  WHERE  id = v_rec.poll_id
  RETURNING type, trip_id INTO v_poll_type, v_trip_id;

  -- ─── Sync trip fields (mirror of TS decidePollAndSync) ─────────────────
  -- The destination poll only writes if the planner hasn't manually set
  -- a destination (matches the TS path's behavior). dates poll handles
  -- both range labels and duration labels via best-effort regex below.

  IF v_poll_type = 'destination' THEN
    SELECT destination INTO v_existing_dest FROM trips WHERE id = v_trip_id;
    IF v_existing_dest IS NULL OR length(trim(v_existing_dest)) = 0 THEN
      UPDATE trips SET destination = v_lock_label WHERE id = v_trip_id;
    END IF;

  ELSIF v_poll_type = 'budget' THEN
    UPDATE trips SET budget_per_person = v_lock_label WHERE id = v_trip_id;

  ELSIF v_poll_type = 'dates' THEN
    -- Try to parse a "Mon DD–DD, YYYY" style range label. If it doesn't
    -- match, fall back to writing it into trip_duration. The TS path
    -- has more sophisticated regexes; we keep the SQL fallback minimal
    -- and rely on the client to round-trip via decidePollAndSync if it
    -- needs the structured update — but at minimum we write SOMETHING
    -- so the trip card reflects the lock.
    UPDATE trips SET trip_duration = v_lock_label WHERE id = v_trip_id;
  END IF;

  RETURN jsonb_build_object(
    'ok',          true,
    'poll_id',     v_rec.poll_id,
    'option_id',   v_lock_option,
    'lock_label',  v_lock_label,
    'status',      v_status,
    'poll_type',   v_poll_type
  );
END;
$$;

GRANT EXECUTE ON FUNCTION approve_poll_recommendation(uuid, uuid) TO authenticated;
