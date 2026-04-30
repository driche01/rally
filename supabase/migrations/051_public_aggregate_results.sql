-- ============================================================
-- Migration 051: Public aggregate results RPC
--
-- The public live-results page at /results/[shareToken] shows the same
-- vote totals the planner sees on the dashboard, but to anyone with the
-- share token. We don't want to relax RLS on poll_responses to allow
-- direct anon SELECT — instead, this SECURITY DEFINER RPC takes a
-- share_token, validates it against trips.share_token, and returns the
-- aggregated counts in a single call.
--
-- Returns shape:
--   {
--     ok: true,
--     trip: { id, name, destination, status, book_by_date, responses_due_date, ... },
--     polls: [
--       { id, title, type, status, decided_option_id,
--         options: [ { id, label, position, votes } ] }
--     ],
--     total_responses: <int>
--   }
--
-- Returns { ok: false, reason: 'not_found' } for invalid/expired tokens.
-- ============================================================

CREATE OR REPLACE FUNCTION get_aggregate_results_by_share_token(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_trip            trips%ROWTYPE;
  v_polls           jsonb;
  v_total           int;
BEGIN
  IF p_token IS NULL OR length(trim(p_token)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_token');
  END IF;

  SELECT * INTO v_trip
  FROM trips
  WHERE share_token = p_token
    AND status = 'active';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id',                 p.id,
      'title',              p.title,
      'type',               p.type,
      'status',             p.status,
      'decided_option_id',  p.decided_option_id,
      'options',            (
        SELECT COALESCE(jsonb_agg(
          jsonb_build_object(
            'id',       o.id,
            'label',    o.label,
            'position', o.position,
            'votes',    COALESCE(c.cnt, 0)
          ) ORDER BY o.position
        ), '[]'::jsonb)
        FROM poll_options o
        LEFT JOIN (
          SELECT option_id, count(*) AS cnt
          FROM poll_responses
          WHERE poll_id = p.id
          GROUP BY option_id
        ) c ON c.option_id = o.id
        WHERE o.poll_id = p.id
      )
    ) ORDER BY p.position
  ), '[]'::jsonb) INTO v_polls
  FROM polls p
  WHERE p.trip_id = v_trip.id
    AND p.status IN ('live', 'decided');

  SELECT count(DISTINCT respondent_id) INTO v_total
  FROM poll_responses pr
  JOIN polls p ON p.id = pr.poll_id
  WHERE p.trip_id = v_trip.id;

  RETURN jsonb_build_object(
    'ok', true,
    'trip', jsonb_build_object(
      'id',                  v_trip.id,
      'name',                v_trip.name,
      'destination',         v_trip.destination,
      'status',              v_trip.status,
      'book_by_date',        v_trip.book_by_date,
      'responses_due_date',  v_trip.responses_due_date,
      'start_date',          v_trip.start_date,
      'end_date',            v_trip.end_date,
      'budget_per_person',   v_trip.budget_per_person
    ),
    'polls', v_polls,
    'total_responses', COALESCE(v_total, 0)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_aggregate_results_by_share_token(text) TO anon, authenticated;
