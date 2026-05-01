-- Switch the recommendation confidence metric from "margin of lead" to
-- "share who agree". Margin-of-lead misreports multi-select polls — when
-- May 8 works for 2/2 respondents but other days do too, the lead is 0
-- and the planner sees "Low confidence" even though the winner literally
-- works for everyone.
--
-- New formula:
--   confidence = winner.works_for / total_distinct_voters
--
-- Threshold changes (applied client-side in DecisionQueueCard.tsx):
--   ≥ 0.8 → High, ≥ 0.5 → Medium, < 0.5 → Low, null → No data.

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
  v_total_voters    int;
  v_winner_id       uuid;
  v_winner_label    text;
  v_winner_count    int;
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

  SELECT count(DISTINCT respondent_id) INTO v_total_voters
  FROM poll_responses
  WHERE poll_id = p_poll_id;

  WITH option_works AS (
    SELECT
      po.id        AS option_id,
      po.position  AS position,
      po.label     AS label,
      CASE
        WHEN v_poll.type = 'budget' THEN (
          SELECT count(DISTINCT pr.respondent_id)
          FROM poll_responses pr
          JOIN poll_options pick ON pick.id = pr.option_id
          WHERE pr.poll_id = p_poll_id
            AND pick.position >= po.position
        )
        ELSE (
          SELECT count(DISTINCT pr.respondent_id)
          FROM poll_responses pr
          WHERE pr.poll_id = p_poll_id AND pr.option_id = po.id
        )
      END AS works_for
    FROM poll_options po
    WHERE po.poll_id = p_poll_id
  )
  SELECT COALESCE(jsonb_object_agg(option_id::text, works_for), '{}'::jsonb)
  INTO v_breakdown
  FROM option_works;

  SELECT option_id, works_for, label
  INTO v_winner_id, v_winner_count, v_winner_label
  FROM (
    SELECT
      po.id        AS option_id,
      po.position  AS position,
      po.label     AS label,
      CASE
        WHEN v_poll.type = 'budget' THEN (
          SELECT count(DISTINCT pr.respondent_id)
          FROM poll_responses pr
          JOIN poll_options pick ON pick.id = pr.option_id
          WHERE pr.poll_id = p_poll_id
            AND pick.position >= po.position
        )
        ELSE (
          SELECT count(DISTINCT pr.respondent_id)
          FROM poll_responses pr
          WHERE pr.poll_id = p_poll_id AND pr.option_id = po.id
        )
      END AS works_for
    FROM poll_options po
    WHERE po.poll_id = p_poll_id
    ORDER BY works_for DESC, position ASC
    LIMIT 1
  ) w;

  -- Confidence = share of respondents the winning option works for.
  IF v_total_voters > 0 AND v_winner_count IS NOT NULL THEN
    v_confidence := round((v_winner_count::numeric / v_total_voters), 2);
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

  IF v_winner_label IS NULL THEN
    v_rec_text := 'No clear leader yet — wait for more responses or pick manually.';
  ELSE
    v_rec_text := format(
      '%s works for %s of %s%s.',
      v_winner_label,
      v_winner_count,
      v_total_voters,
      CASE WHEN v_total_voters = 1 THEN ' respondent' ELSE ' respondents' END
    );
    IF array_length(v_holdouts, 1) > 0 THEN
      v_rec_text := v_rec_text || format(' (%s still haven''t voted)', array_length(v_holdouts, 1));
    END IF;
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

-- Recompute every pending rec under the new formula. Held / approved
-- rows are preserved.
DELETE FROM poll_recommendations WHERE status = 'pending';
