-- ============================================================
-- Migration 056: Undo poll lock within 5-minute grace window
--
-- The "lock without holdouts" path can broadcast to every participant
-- with no second confirmation. If the planner fat-fingers, they need
-- a way to roll it back before too many people read the SMS.
--
-- This RPC reverts the lock if:
--   - the recommendation is in status 'approved' or 'edited'
--   - planner_action_at is within the last 5 minutes
--   - the caller is a trip_member of the underlying trip
--
-- Effects: poll → status='live', decided_option_id=NULL.
-- Recommendation → status='pending', locked_value=NULL,
-- planner_action_at + planner_action_by cleared.
--
-- The participant SMS sent at lock cannot be unsent. A follow-up
-- broadcast is the planner's responsibility (out of scope for v1).
-- ============================================================

CREATE OR REPLACE FUNCTION undo_poll_lock(p_recommendation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid          uuid;
  v_authorized   boolean;
  v_rec          poll_recommendations%ROWTYPE;
  v_age_seconds  numeric;
  v_grace_seconds constant int := 300;  -- 5 min
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  SELECT * INTO v_rec FROM poll_recommendations WHERE id = p_recommendation_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  IF v_rec.status NOT IN ('approved', 'edited') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_locked');
  END IF;

  IF v_rec.planner_action_at IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_action_timestamp');
  END IF;

  v_age_seconds := EXTRACT(EPOCH FROM (now() - v_rec.planner_action_at));
  IF v_age_seconds > v_grace_seconds THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'grace_expired',
                              'age_seconds', v_age_seconds);
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM trip_members
    WHERE trip_id = v_rec.trip_id AND user_id = v_uid
  ) INTO v_authorized;
  IF NOT v_authorized THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  -- Revert the poll.
  UPDATE polls
  SET    status            = 'live',
         decided_option_id = NULL
  WHERE  id = v_rec.poll_id;

  -- Revert the recommendation.
  UPDATE poll_recommendations
  SET    status            = 'pending',
         locked_value      = NULL,
         planner_action_at = NULL,
         planner_action_by = NULL
  WHERE  id = p_recommendation_id;

  RETURN jsonb_build_object(
    'ok',          true,
    'poll_id',     v_rec.poll_id,
    'age_seconds', v_age_seconds
  );
END;
$$;

GRANT EXECUTE ON FUNCTION undo_poll_lock(uuid) TO authenticated;
