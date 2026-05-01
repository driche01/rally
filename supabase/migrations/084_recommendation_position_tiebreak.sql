-- Tie-break poll recommendations by poll_options.position (ASC) instead
-- of option_id (random UUID). Concretely:
--   • Budget polls store options in ascending price order
--     (Under $500, $500–$1k, $1k–$2.5k, Above $2.5k), so a tie now
--     resolves to the cheaper option — the explicit ask.
--   • Destination / custom / etc. polls inherit the planner's display
--     order as the tiebreaker, which beats a random UUID order on
--     determinism without surprising anyone.

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

  SELECT EXISTS (
    SELECT 1 FROM trip_members
    WHERE trip_id = v_poll.trip_id AND user_id = v_uid
  ) INTO v_authorized;
  IF NOT v_authorized THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  SELECT id INTO v_users_id FROM users WHERE auth_user_id = v_uid LIMIT 1;

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

  -- Winner: most votes; break ties by the option's display position
  -- (ASC). Budget polls store options in ascending price order, so ties
  -- on a budget poll now pick the lower price point.
  SELECT pr.option_id, vote_count INTO v_winner_id, v_winner_count
  FROM (
    SELECT
      pr.option_id,
      COUNT(*) AS vote_count,
      MIN(po.position) AS position
    FROM poll_responses pr
    JOIN poll_options po ON po.id = pr.option_id
    WHERE pr.poll_id = p_poll_id
    GROUP BY pr.option_id
    ORDER BY vote_count DESC, position ASC
    LIMIT 1
  ) pr;

  SELECT vote_count INTO v_runnerup_count
  FROM (
    SELECT pr.option_id, COUNT(*) AS vote_count, MIN(po.position) AS position
    FROM poll_responses pr
    JOIN poll_options po ON po.id = pr.option_id
    WHERE pr.poll_id = p_poll_id AND pr.option_id IS DISTINCT FROM v_winner_id
    GROUP BY pr.option_id
    ORDER BY vote_count DESC, position ASC
    LIMIT 1
  ) r;
  IF v_runnerup_count IS NULL THEN v_runnerup_count := 0; END IF;

  IF v_total_votes > 0 THEN
    v_confidence := round(((v_winner_count - v_runnerup_count)::numeric / v_total_votes), 2);
  ELSE
    v_confidence := NULL;
  END IF;

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
