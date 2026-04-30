-- ============================================================
-- Migration 048: Decision queue RPCs
--
-- The dashboard "Pending Decisions" pinned section is powered by
-- poll_recommendations rows (table created in migration 044). Three
-- RPCs handle the full lifecycle:
--
--   request_poll_recommendation — compute + insert a recommendation
--                                  for a live poll. Idempotent: if a
--                                  pending row exists, return it; if
--                                  the poll is already decided, no-op.
--
--   approve_poll_recommendation — mark approved (or edited if an
--                                  override option is supplied), lock
--                                  the poll, return the locked label
--                                  so the caller can fire the lock
--                                  broadcast SMS.
--
--   hold_poll_recommendation    — defer for more input; sets status =
--                                  'held' with optional hold_until.
--
-- Vote breakdown shape: { "<option_id>": <count>, ... }
-- Holdouts: participant ids (trip_session_participants.id) of active
-- attending non-planners with no poll_response row for this poll.
-- Confidence: leading_margin / total_votes (0..1). Null if no votes.
-- ============================================================


-- ─── 1. request_poll_recommendation ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION request_poll_recommendation(p_poll_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid             uuid;
  v_users_id        uuid;
  v_authorized      boolean;
  v_poll            polls%ROWTYPE;
  v_existing        poll_recommendations%ROWTYPE;
  v_rec_id          uuid;
  v_breakdown       jsonb;
  v_total_votes     int;
  v_winner_id       uuid;
  v_winner_label    text;
  v_winner_count    int;
  v_runnerup_count  int;
  v_confidence      numeric(3,2);
  v_holdouts        uuid[];
  v_rec_text        text;
  v_session_id      uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  SELECT * INTO v_poll FROM polls WHERE id = p_poll_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'poll_not_found');
  END IF;
  IF v_poll.status = 'decided' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_decided');
  END IF;

  -- Authorize: caller must be a trip_member of the poll's trip.
  SELECT EXISTS (
    SELECT 1 FROM trip_members
    WHERE trip_id = v_poll.trip_id AND user_id = v_uid
  ) INTO v_authorized;
  IF NOT v_authorized THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  SELECT id INTO v_users_id FROM users WHERE auth_user_id = v_uid LIMIT 1;

  -- If a pending recommendation already exists, return it (the unique
  -- partial index in 044 prevents duplicates anyway, but we want a clean
  -- response shape rather than a 23505 error).
  SELECT * INTO v_existing
  FROM poll_recommendations
  WHERE poll_id = p_poll_id AND status = 'pending'
  LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'reason', 'existed', 'recommendation_id', v_existing.id);
  END IF;

  -- Vote breakdown.
  SELECT
    COALESCE(jsonb_object_agg(option_id::text, vote_count), '{}'::jsonb),
    COALESCE(SUM(vote_count), 0)
  INTO v_breakdown, v_total_votes
  FROM (
    SELECT option_id, COUNT(*) AS vote_count
    FROM poll_responses
    WHERE poll_id = p_poll_id
    GROUP BY option_id
  ) sub;

  -- Winner + runner-up for confidence.
  SELECT option_id, vote_count INTO v_winner_id, v_winner_count
  FROM (
    SELECT option_id, COUNT(*) AS vote_count
    FROM poll_responses
    WHERE poll_id = p_poll_id
    GROUP BY option_id
    ORDER BY vote_count DESC, option_id
    LIMIT 1
  ) w;

  SELECT vote_count INTO v_runnerup_count
  FROM (
    SELECT option_id, COUNT(*) AS vote_count
    FROM poll_responses
    WHERE poll_id = p_poll_id AND option_id IS DISTINCT FROM v_winner_id
    GROUP BY option_id
    ORDER BY vote_count DESC
    LIMIT 1
  ) r;
  IF v_runnerup_count IS NULL THEN v_runnerup_count := 0; END IF;

  IF v_total_votes > 0 THEN
    v_confidence := round(((v_winner_count - v_runnerup_count)::numeric / v_total_votes), 2);
  ELSE
    v_confidence := NULL;
  END IF;

  -- Holdouts: active+attending non-planner participants in the trip's
  -- session with no poll_response for this poll. Map by phone → respondent.
  SELECT id INTO v_session_id
  FROM trip_sessions
  WHERE trip_id = v_poll.trip_id
    AND status IN ('ACTIVE', 'PAUSED', 'RE_ENGAGEMENT_PENDING')
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_session_id IS NOT NULL THEN
    SELECT COALESCE(array_agg(p.id), ARRAY[]::uuid[]) INTO v_holdouts
    FROM trip_session_participants p
    WHERE p.trip_session_id = v_session_id
      AND p.status = 'active'
      AND p.is_attending = true
      AND p.is_planner = false
      AND NOT EXISTS (
        SELECT 1 FROM respondents r
        JOIN poll_responses pr ON pr.respondent_id = r.id
        WHERE r.trip_id = v_poll.trip_id
          AND r.phone = p.phone
          AND pr.poll_id = p_poll_id
      );
  ELSE
    v_holdouts := ARRAY[]::uuid[];
  END IF;

  -- Winner label.
  IF v_winner_id IS NOT NULL THEN
    SELECT label INTO v_winner_label FROM poll_options WHERE id = v_winner_id;
  END IF;

  IF v_winner_label IS NULL THEN
    v_rec_text := 'No clear leader yet — wait for more responses or pick manually.';
  ELSE
    v_rec_text := format(
      '%s leads with %s of %s votes%s.',
      v_winner_label,
      v_winner_count,
      v_total_votes,
      CASE
        WHEN array_length(v_holdouts, 1) > 0
          THEN format(' (%s still haven''t voted)', array_length(v_holdouts, 1))
        ELSE ''
      END
    );
  END IF;

  INSERT INTO poll_recommendations (
    poll_id, trip_id, recommended_option_id, recommendation_text,
    vote_breakdown, holdout_participant_ids, confidence, status
  ) VALUES (
    p_poll_id, v_poll.trip_id, v_winner_id, v_rec_text,
    v_breakdown, v_holdouts, v_confidence, 'pending'
  ) RETURNING id INTO v_rec_id;

  RETURN jsonb_build_object('ok', true, 'reason', 'created', 'recommendation_id', v_rec_id);
END;
$$;

GRANT EXECUTE ON FUNCTION request_poll_recommendation(uuid) TO authenticated;


-- ─── 2. approve_poll_recommendation ─────────────────────────────────────────
-- If p_override_option_id is supplied, status = 'edited'. Otherwise
-- status = 'approved'. Both lock the underlying poll and return the
-- locked label so the caller can fan out the SMS broadcast.

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

  -- Lock the underlying poll. The decision-lock SMS broadcast is fired
  -- by the caller (decidePollAndSync in app code) since the broadcast
  -- helper lives client-side; here we just mark the poll decided.
  UPDATE polls
  SET    status = 'decided',
         decided_option_id = v_lock_option
  WHERE  id = v_rec.poll_id;

  RETURN jsonb_build_object(
    'ok',          true,
    'poll_id',     v_rec.poll_id,
    'option_id',   v_lock_option,
    'lock_label',  v_lock_label,
    'status',      v_status
  );
END;
$$;

GRANT EXECUTE ON FUNCTION approve_poll_recommendation(uuid, uuid) TO authenticated;


-- ─── 3. hold_poll_recommendation ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION hold_poll_recommendation(
  p_recommendation_id uuid,
  p_hold_until        timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid         uuid;
  v_users_id    uuid;
  v_authorized  boolean;
  v_rec         poll_recommendations%ROWTYPE;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  SELECT * INTO v_rec FROM poll_recommendations WHERE id = p_recommendation_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF v_rec.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_resolved');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM trip_members
    WHERE trip_id = v_rec.trip_id AND user_id = v_uid
  ) INTO v_authorized;
  IF NOT v_authorized THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  SELECT id INTO v_users_id FROM users WHERE auth_user_id = v_uid LIMIT 1;

  UPDATE poll_recommendations
  SET    status            = 'held',
         hold_until        = p_hold_until,
         planner_action_at = now(),
         planner_action_by = v_users_id
  WHERE  id = p_recommendation_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION hold_poll_recommendation(uuid, timestamptz) TO authenticated;
