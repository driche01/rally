-- Migration 061: approve_poll_recommendation_with_dates
--
-- The decision queue's "Pick" action used to expand a flat list of
-- single-day options for the dates poll. The planner could only lock
-- one day at a time, which is wrong for the common case where the
-- trip spans multiple days.
--
-- This RPC accepts an array of ISO dates picked from a calendar in the
-- DecisionQueueCard. It:
--   * Validates the recommendation is for a 'dates' poll
--   * Builds a locked label ("Jun 17–19" / "Jun 17, Jun 19" / "Jun 17")
--   * Sets polls.status='decided' + decided_option_id (best-effort
--     match to the first picked date's existing poll_option, else NULL)
--   * Writes trips.start_date / trips.end_date from min/max of picks
--   * Marks the recommendation as 'edited' (since it's an override)
--
-- Mirrors the auth + membership gating from migration 052's
-- approve_poll_recommendation. Returns the same shape so the client
-- can fire the lock-broadcast SMS exactly the same way.

CREATE OR REPLACE FUNCTION approve_poll_recommendation_with_dates(
  p_recommendation_id uuid,
  p_dates date[]
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
  v_poll_type     text;
  v_trip_id       uuid;
  v_first_date    date;
  v_last_date     date;
  v_match_option  uuid;
  v_first_label   text;
  v_lock_label    text;
  v_sorted_dates  date[];
  v_consecutive   boolean;
  v_month_short   text;
  v_day_str       text;
  v_label_parts   text[];
  v_d             date;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  IF p_dates IS NULL OR array_length(p_dates, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_dates');
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

  SELECT type, trip_id INTO v_poll_type, v_trip_id
  FROM polls WHERE id = v_rec.poll_id;
  IF v_poll_type IS NULL OR v_poll_type <> 'dates' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'wrong_poll_type');
  END IF;

  -- Sort + dedupe picked dates.
  SELECT array_agg(DISTINCT d ORDER BY d) INTO v_sorted_dates
  FROM unnest(p_dates) AS d;

  v_first_date := v_sorted_dates[1];
  v_last_date  := v_sorted_dates[array_length(v_sorted_dates, 1)];

  -- Are all picked dates consecutive (each one day after the previous)?
  v_consecutive := (
    SELECT COALESCE(bool_and(diff = 1), true)
    FROM (
      SELECT (d - lag(d) OVER (ORDER BY d)) AS diff
      FROM unnest(v_sorted_dates) AS d
    ) sub
    WHERE diff IS NOT NULL
  );

  -- Build the human-readable lock label.
  IF array_length(v_sorted_dates, 1) = 1 THEN
    v_lock_label := to_char(v_first_date, 'Mon DD');
  ELSIF v_consecutive THEN
    -- "Jun 17–19" if same month, "Jun 28 – Jul 2" otherwise.
    IF date_part('month', v_first_date) = date_part('month', v_last_date) THEN
      v_lock_label := to_char(v_first_date, 'Mon DD') || E'–'
                   || to_char(v_last_date, 'DD');
    ELSE
      v_lock_label := to_char(v_first_date, 'Mon DD') || ' '
                   || E'–' || ' '
                   || to_char(v_last_date, 'Mon DD');
    END IF;
  ELSE
    -- Non-consecutive — comma-list of labels.
    v_label_parts := ARRAY[]::text[];
    FOREACH v_d IN ARRAY v_sorted_dates LOOP
      v_label_parts := v_label_parts || to_char(v_d, 'Mon DD');
    END LOOP;
    v_lock_label := array_to_string(v_label_parts, ', ');
  END IF;

  -- Best-effort: find an existing poll_option whose label matches the
  -- first picked date's "Mon DD" form. Used only as a back-compat
  -- pointer for downstream code that reads decided_option_id; the
  -- actual locked value lives in poll_recommendations.locked_value.
  v_first_label := to_char(v_first_date, 'Mon DD');
  v_first_label := regexp_replace(v_first_label, '\s+', ' ', 'g');

  SELECT id INTO v_match_option
  FROM poll_options
  WHERE poll_id = v_rec.poll_id AND label = v_first_label
  LIMIT 1;

  SELECT id INTO v_users_id FROM users WHERE auth_user_id = v_uid LIMIT 1;

  -- Lock the recommendation. Always 'edited' since this path is a
  -- planner override (calendar pick is never auto-recommended).
  UPDATE poll_recommendations
  SET    status            = 'edited',
         locked_value      = v_lock_label,
         planner_action_at = now(),
         planner_action_by = v_users_id
  WHERE  id = p_recommendation_id;

  -- Lock the underlying poll.
  UPDATE polls
  SET    status = 'decided',
         decided_option_id = v_match_option
  WHERE  id = v_rec.poll_id;

  -- Sync trip primitives — this is the big improvement over the
  -- original RPC (which wrote into trip_duration for dates polls,
  -- which was wrong).
  UPDATE trips
  SET    start_date = v_first_date,
         end_date   = v_last_date
  WHERE  id = v_trip_id;

  RETURN jsonb_build_object(
    'ok',          true,
    'poll_id',     v_rec.poll_id,
    'option_id',   v_match_option,
    'lock_label',  v_lock_label,
    'status',      'edited',
    'poll_type',   v_poll_type,
    'start_date',  v_first_date,
    'end_date',    v_last_date
  );
END;
$$;

GRANT EXECUTE ON FUNCTION approve_poll_recommendation_with_dates(uuid, date[]) TO authenticated;
