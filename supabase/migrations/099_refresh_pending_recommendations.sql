-- ============================================================
-- Migration 098: refresh pending recommendations on every call
--
-- Two compounding bugs were keeping the DecisionQueueCard empty even
-- when every member had voted:
--
-- 1. Stale pending recs. The previous request_poll_recommendation
--    short-circuited when a pending row already existed and returned
--    `existed`. So a rec computed when only 2 of 4 had responded kept
--    its 2-person holdout list forever — votes 3 and 4 never made it
--    back into vote_breakdown / holdout_participant_ids / confidence.
--    The client hook's "skip polls that already have a pending rec"
--    optimization made this worse: nothing ever refreshed the row.
--
-- 2. Phone-mismatch ghost holdouts. The holdout query in 086 keyed on
--    exact `r.phone = p.phone`. Any drift between respondents.phone
--    (set by member-add / survey submit) and trip_session_participants
--    .phone (set by app_add_trip_contacts) — e.g. one row got "+1..."
--    while the other got "1..." — wedged a real voter into
--    perpetual-holdout status. Even one ghost holdout is enough for
--    DecisionQueueCard to hide the rec until the book-by window opens.
--
-- This migration replaces the RPC with an always-recompute upsert: it
-- recomputes breakdown / winner / holdouts / confidence on every call
-- and either UPDATEs the existing pending row or INSERTs a fresh one.
-- The holdout join now compares normalize_phone() on both sides.
-- ============================================================

CREATE OR REPLACE FUNCTION request_poll_recommendation(p_poll_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid             uuid;
  v_authorized      boolean;
  v_poll            polls%ROWTYPE;
  v_existing_id     uuid;
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

  -- ─── Recompute breakdown + winner ─────────────────────────────────────
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

  IF v_total_voters > 0 AND v_winner_count IS NOT NULL THEN
    v_confidence := round((v_winner_count::numeric / v_total_voters), 2);
  ELSE
    v_confidence := NULL;
  END IF;

  -- ─── Holdouts (normalized-phone safe) ─────────────────────────────────
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
          AND normalize_phone(r.phone) = normalize_phone(p.phone)
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

  -- ─── Upsert ───────────────────────────────────────────────────────────
  -- Pending row exists → refresh it with current data. Otherwise insert
  -- a new one. The "skip if pending exists" pattern that lived here is
  -- exactly what stranded stale rows; making the RPC always-recompute
  -- means the client hook + scheduler can call it idempotently and
  -- always get fresh breakdown / holdouts / confidence.
  SELECT id INTO v_existing_id
  FROM poll_recommendations
  WHERE poll_id = p_poll_id AND status = 'pending'
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    UPDATE poll_recommendations
    SET    recommended_option_id   = v_winner_id,
           recommendation_text     = v_rec_text,
           vote_breakdown          = v_breakdown,
           holdout_participant_ids = v_holdouts,
           confidence              = v_confidence
    WHERE  id = v_existing_id;
    RETURN jsonb_build_object('ok', true, 'reason', 'refreshed', 'recommendation_id', v_existing_id);
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


-- ─── One-shot refresh of every existing pending rec ────────────────────
-- For each currently-pending row, re-call the RPC's logic so trips
-- that opened before this migration immediately get accurate holdout
-- counts. Done by setting status to a sentinel + invoking via a CTE
-- would be fancy; simpler to just have the RPC self-invoke per pending
-- poll. But auth.uid() is null inside the migration context, so do it
-- inline via direct UPDATEs computed the same way.
WITH refreshed AS (
  SELECT
    rec.id            AS rec_id,
    rec.poll_id,
    rec.trip_id,
    p.type            AS poll_type,
    (
      SELECT count(DISTINCT pr.respondent_id)
      FROM poll_responses pr
      WHERE pr.poll_id = rec.poll_id
    )                 AS total_voters,
    (
      SELECT id
      FROM trip_sessions
      WHERE trip_id = rec.trip_id
        AND status IN ('ACTIVE', 'PAUSED', 'RE_ENGAGEMENT_PENDING')
      ORDER BY created_at DESC
      LIMIT 1
    )                 AS session_id
  FROM poll_recommendations rec
  JOIN polls p ON p.id = rec.poll_id
  WHERE rec.status = 'pending'
),
breakdowns AS (
  SELECT
    r.rec_id,
    COALESCE(jsonb_object_agg(po.id::text, ow.works_for), '{}'::jsonb) AS breakdown
  FROM refreshed r
  JOIN poll_options po ON po.poll_id = r.poll_id
  CROSS JOIN LATERAL (
    SELECT CASE
      WHEN r.poll_type = 'budget' THEN (
        SELECT count(DISTINCT pr.respondent_id)
        FROM poll_responses pr
        JOIN poll_options pick ON pick.id = pr.option_id
        WHERE pr.poll_id = r.poll_id
          AND pick.position >= po.position
      )
      ELSE (
        SELECT count(DISTINCT pr.respondent_id)
        FROM poll_responses pr
        WHERE pr.poll_id = r.poll_id AND pr.option_id = po.id
      )
    END AS works_for
  ) ow
  GROUP BY r.rec_id
),
winners AS (
  SELECT DISTINCT ON (r.rec_id)
    r.rec_id,
    po.id    AS winner_id,
    po.label AS winner_label,
    CASE
      WHEN r.poll_type = 'budget' THEN (
        SELECT count(DISTINCT pr.respondent_id)
        FROM poll_responses pr
        JOIN poll_options pick ON pick.id = pr.option_id
        WHERE pr.poll_id = r.poll_id
          AND pick.position >= po.position
      )
      ELSE (
        SELECT count(DISTINCT pr.respondent_id)
        FROM poll_responses pr
        WHERE pr.poll_id = r.poll_id AND pr.option_id = po.id
      )
    END      AS winner_count,
    r.total_voters
  FROM refreshed r
  JOIN poll_options po ON po.poll_id = r.poll_id
  ORDER BY r.rec_id,
           (CASE
             WHEN r.poll_type = 'budget' THEN (
               SELECT count(DISTINCT pr.respondent_id)
               FROM poll_responses pr
               JOIN poll_options pick ON pick.id = pr.option_id
               WHERE pr.poll_id = r.poll_id
                 AND pick.position >= po.position
             )
             ELSE (
               SELECT count(DISTINCT pr.respondent_id)
               FROM poll_responses pr
               WHERE pr.poll_id = r.poll_id AND pr.option_id = po.id
             )
           END) DESC,
           po.position ASC
),
holdouts AS (
  SELECT
    r.rec_id,
    COALESCE(array_agg(p.id), ARRAY[]::uuid[]) AS holdout_ids
  FROM refreshed r
  LEFT JOIN trip_session_participants p
    ON p.trip_session_id = r.session_id
   AND p.status = 'active'
   AND p.is_attending = true
   AND p.is_planner = false
   AND NOT EXISTS (
     SELECT 1 FROM respondents resp
     JOIN poll_responses pr ON pr.respondent_id = resp.id
     WHERE resp.trip_id = r.trip_id
       AND normalize_phone(resp.phone) = normalize_phone(p.phone)
       AND pr.poll_id = r.poll_id
   )
  WHERE r.session_id IS NOT NULL
  GROUP BY r.rec_id
)
UPDATE poll_recommendations rec
SET    recommended_option_id   = w.winner_id,
       vote_breakdown          = b.breakdown,
       holdout_participant_ids = COALESCE(h.holdout_ids, ARRAY[]::uuid[]),
       confidence              = CASE
         WHEN w.total_voters > 0 AND w.winner_count IS NOT NULL
         THEN round((w.winner_count::numeric / w.total_voters), 2)
         ELSE NULL
       END,
       recommendation_text     = CASE
         WHEN w.winner_label IS NULL
         THEN 'No clear leader yet — wait for more responses or pick manually.'
         ELSE format(
           '%s works for %s of %s%s.',
           w.winner_label,
           w.winner_count,
           w.total_voters,
           CASE WHEN w.total_voters = 1 THEN ' respondent' ELSE ' respondents' END
         )
         || CASE
           WHEN array_length(COALESCE(h.holdout_ids, ARRAY[]::uuid[]), 1) > 0
           THEN format(' (%s still haven''t voted)', array_length(h.holdout_ids, 1))
           ELSE ''
         END
       END
FROM winners w
LEFT JOIN breakdowns b ON b.rec_id = w.rec_id
LEFT JOIN holdouts   h ON h.rec_id = w.rec_id
WHERE rec.id = w.rec_id
  AND rec.status = 'pending';
