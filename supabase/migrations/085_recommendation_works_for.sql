-- Switch poll recommendations from "votes for the leading option" to
-- "respondents this option works for". For multi-select polls (dates,
-- destination), the two metrics are usually identical — each respondent
-- picks once per option. The big change is for budget polls, which are
-- single-select but ordered by ascending price: a respondent picking
-- "$1k–$2.5k" implicitly accepts every cheaper range too. Under that
-- model, "Under $500" works for every respondent who isn't capped below
-- it — typically all of them.
--
-- Rules:
--   • Budget polls (poll.type='budget'): an option O works for respondent
--     R iff R picked an option at or above O's position (price tiers are
--     stored ASC by price, so position(R's pick) >= position(O) means
--     R's max budget ≥ O).
--   • All other polls: works_for = distinct respondents who picked O.
--
-- vote_breakdown now holds works_for counts per option, the winner is
-- chosen by max works_for (position ASC tiebreak — same rule as 084),
-- confidence is (winner - runner_up) / total_distinct_voters, and the
-- recommendation_text reads "{X} works for {N} of {M} respondents."

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

  -- Total distinct respondents who voted on this poll. Drives the
  -- denominator everywhere below ("works for X of Y").
  SELECT count(DISTINCT respondent_id) INTO v_total_voters
  FROM poll_responses
  WHERE poll_id = p_poll_id;

  -- Per-option "works for" counts.
  WITH option_works AS (
    SELECT
      po.id        AS option_id,
      po.position  AS position,
      po.label     AS label,
      CASE
        WHEN v_poll.type = 'budget' THEN (
          -- Budget: a pick at position P implies acceptance of every
          -- cheaper option (position 0..P). So an option O works for
          -- every respondent whose pick has position >= O.position.
          SELECT count(DISTINCT pr.respondent_id)
          FROM poll_responses pr
          JOIN poll_options pick ON pick.id = pr.option_id
          WHERE pr.poll_id = p_poll_id
            AND pick.position >= po.position
        )
        ELSE (
          -- Other poll types: works_for = distinct respondents who
          -- explicitly picked this option.
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

  -- Winner: highest works_for, tiebreak by position ASC (cheaper-wins
  -- on budget; planner's display order on everything else).
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

  -- Runner-up for the confidence calculation.
  SELECT works_for INTO v_runnerup_count
  FROM (
    SELECT
      po.id        AS option_id,
      po.position  AS position,
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
      AND po.id IS DISTINCT FROM v_winner_id
    ORDER BY works_for DESC, position ASC
    LIMIT 1
  ) r;
  IF v_runnerup_count IS NULL THEN v_runnerup_count := 0; END IF;

  IF v_total_voters > 0 THEN
    v_confidence := round(((v_winner_count - v_runnerup_count)::numeric / v_total_voters), 2);
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

-- Clear pending recommendations created with the old "votes" formula so
-- the next scheduler tick (or first dashboard load) regenerates them
-- with the new "works for" semantics. Held / approved / edited rows are
-- preserved — only the as-yet-unactioned recs get recomputed.
DELETE FROM poll_recommendations WHERE status = 'pending';
