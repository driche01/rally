-- ============================================================
-- Migration 100: approve_poll_recommendation parses dates labels
-- and writes trips.start_date / end_date instead of trip_duration.
--
-- Dates polls store per-day option labels like "Jun 17". When the
-- planner approves one via the dashboard's plain "Approve" button,
-- the previous version of this RPC stuffed that label into
-- trips.trip_duration — a free-text column meant for things like
-- "3 nights". The trip card and itinerary tab both read trip.start_date
-- as the canonical source, so trip_duration="Jun 17" was simultaneously
-- nonsensical and useless: the dates never made it to the right field,
-- and the itinerary stayed stuck on its "set trip dates" empty state.
--
-- The "Pick" path (approve_poll_recommendation_with_dates, migration
-- 061) already writes start/end_date correctly. This migration brings
-- the regular path to parity by parsing the locked label with the
-- same shapes parseDateRangeLabel handles client-side:
--   "Jun 17"          → start = end = Jun 17, current year
--   "Jun 17–20"       → start = Jun 17, end = Jun 20, current year
--   "Jun 17 – Jul 5"  → start = Jun 17, end = Jul 5,   current year
-- If the parsed start date is already in the past relative to today,
-- the year rolls forward to next year (matches the client behavior).
-- ============================================================

-- Helper: 3-letter month abbrev → 1..12. Returns NULL on miss.
CREATE OR REPLACE FUNCTION month_abbr_to_num(p_abbr text)
RETURNS int
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_abbr
    WHEN 'Jan' THEN 1  WHEN 'Feb' THEN 2  WHEN 'Mar' THEN 3
    WHEN 'Apr' THEN 4  WHEN 'May' THEN 5  WHEN 'Jun' THEN 6
    WHEN 'Jul' THEN 7  WHEN 'Aug' THEN 8  WHEN 'Sep' THEN 9
    WHEN 'Oct' THEN 10 WHEN 'Nov' THEN 11 WHEN 'Dec' THEN 12
  END;
$$;

-- Helper: parse a poll-options style date label into a (start, end) pair.
-- Mirrors parseDateRangeLabel() in src/lib/pollFormUtils.ts. Returns NULL
-- when the label doesn't match any of the supported shapes.
CREATE OR REPLACE FUNCTION parse_date_label(p_label text)
RETURNS TABLE(start_date date, end_date date)
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_year       int := EXTRACT(YEAR FROM current_date)::int;
  v_today      date := current_date;
  v_match      text[];
  v_start      date;
  v_end        date;
  v_smonth     int;
  v_emonth     int;
BEGIN
  -- "Jun 17 – Jul 5" (cross-month range, en-dash with spaces)
  v_match := regexp_match(p_label, '^([A-Z][a-z]+)\s+(\d+)\s+–\s+([A-Z][a-z]+)\s+(\d+)$');
  IF v_match IS NOT NULL THEN
    v_smonth := month_abbr_to_num(v_match[1]);
    v_emonth := month_abbr_to_num(v_match[3]);
    IF v_smonth IS NOT NULL AND v_emonth IS NOT NULL THEN
      v_start := make_date(v_year, v_smonth, v_match[2]::int);
      v_end   := make_date(v_year, v_emonth, v_match[4]::int);
      IF v_end < v_today THEN
        v_start := make_date(v_year + 1, v_smonth, v_match[2]::int);
        v_end   := make_date(v_year + 1, v_emonth, v_match[4]::int);
      END IF;
      RETURN QUERY SELECT v_start, v_end;
      RETURN;
    END IF;
  END IF;

  -- "Jun 17–20" (same-month compact range)
  v_match := regexp_match(p_label, '^([A-Z][a-z]+)\s+(\d+)–(\d+)$');
  IF v_match IS NOT NULL THEN
    v_smonth := month_abbr_to_num(v_match[1]);
    IF v_smonth IS NOT NULL THEN
      v_start := make_date(v_year, v_smonth, v_match[2]::int);
      v_end   := make_date(v_year, v_smonth, v_match[3]::int);
      IF v_end < v_today THEN
        v_start := make_date(v_year + 1, v_smonth, v_match[2]::int);
        v_end   := make_date(v_year + 1, v_smonth, v_match[3]::int);
      END IF;
      RETURN QUERY SELECT v_start, v_end;
      RETURN;
    END IF;
  END IF;

  -- "Jun 17" (single day)
  v_match := regexp_match(p_label, '^([A-Z][a-z]+)\s+(\d+)$');
  IF v_match IS NOT NULL THEN
    v_smonth := month_abbr_to_num(v_match[1]);
    IF v_smonth IS NOT NULL THEN
      v_start := make_date(v_year, v_smonth, v_match[2]::int);
      IF v_start < v_today THEN
        v_start := make_date(v_year + 1, v_smonth, v_match[2]::int);
      END IF;
      RETURN QUERY SELECT v_start, v_start;
      RETURN;
    END IF;
  END IF;

  -- No match.
  RETURN;
END;
$$;


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
  v_parsed_start  date;
  v_parsed_end    date;
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

  -- ─── Sync trip fields ────────────────────────────────────────────────
  IF v_poll_type = 'destination' THEN
    SELECT destination INTO v_existing_dest FROM trips WHERE id = v_trip_id;
    IF v_existing_dest IS NULL OR length(trim(v_existing_dest)) = 0 THEN
      UPDATE trips SET destination = v_lock_label WHERE id = v_trip_id;
    END IF;

  ELSIF v_poll_type = 'budget' THEN
    UPDATE trips SET budget_per_person = v_lock_label WHERE id = v_trip_id;

  ELSIF v_poll_type = 'dates' THEN
    -- Parse the locked option label ("Jun 17", "Jun 17–20",
    -- "Jun 17 – Jul 5") and write the canonical trip primitives.
    -- The "Pick" path (approve_poll_recommendation_with_dates) already
    -- handles multi-day picks; this catches the regular Approve path
    -- where the planner accepts the recommended single-option lock.
    -- Falls through silently if the label shape is unexpected — better
    -- to leave start_date null than to clobber it with garbage.
    SELECT s.start_date, s.end_date
    INTO   v_parsed_start, v_parsed_end
    FROM   parse_date_label(v_lock_label) s;

    IF v_parsed_start IS NOT NULL THEN
      UPDATE trips
      SET    start_date = v_parsed_start,
             end_date   = v_parsed_end
      WHERE  id = v_trip_id;
    END IF;
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


-- ─── Backfill: fix trips that were locked under the old behavior ───────
-- For every dates poll already in 'decided' state, parse the decided
-- option's label and write start/end_date if they're still null.
-- Trips whose start_date is already set are left alone (the "Pick"
-- path got there first, or the planner edited manually).
UPDATE trips t
SET    start_date = parsed.start_date,
       end_date   = parsed.end_date
FROM   polls p
JOIN   poll_options po ON po.id = p.decided_option_id
CROSS JOIN LATERAL parse_date_label(po.label) parsed
WHERE  p.trip_id = t.id
  AND  p.type    = 'dates'
  AND  p.status  = 'decided'
  AND  t.start_date IS NULL
  AND  parsed.start_date IS NOT NULL;

-- And clean up any trips whose trip_duration got polluted with what
-- looks like a date label by the pre-fix code path. trip_duration is
-- meant for things like "3 nights" — if it parses as a date, it was
-- the old bug.
UPDATE trips
SET    trip_duration = NULL
WHERE  id IN (
  SELECT t.id
  FROM   trips t,
  LATERAL parse_date_label(t.trip_duration) parsed
  WHERE  t.trip_duration IS NOT NULL
    AND  parsed.start_date IS NOT NULL
);
