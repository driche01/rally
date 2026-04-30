-- ============================================================
-- Migration 077: respondent write-ins for polls
--
-- Lets respondents add new poll_options to a poll when the planner
-- enabled write-ins on it. Two surfaces use this today:
--   • destination polls created with 0 options (planner left it blank
--     so the group fills it in)
--   • duration polls (always — defaults + write-in)
--
-- Schema:
--   • polls.allow_write_ins boolean default false
--
-- RPC: submit_poll_write_in(p_poll_id, p_label, p_session_token)
--   Runs SECURITY DEFINER so anonymous respondents can bypass the
--   planner-only RLS on poll_options through this gated path.
--   • verifies poll.allow_write_ins AND poll.status='live'
--   • verifies session_token matches a respondent on that trip
--   • trims label, caps at 40 chars (mirrors poll_options.label CHECK)
--   • case-insensitive dedupe vs existing options on this poll —
--     duplicates return the existing option_id instead of inserting
--   • returns option_id (jsonb { ok, option_id, deduped })
-- ============================================================

ALTER TABLE public.polls
  ADD COLUMN IF NOT EXISTS allow_write_ins boolean NOT NULL DEFAULT false;


CREATE OR REPLACE FUNCTION submit_poll_write_in(
  p_poll_id uuid,
  p_label text,
  p_session_token text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_poll          polls%ROWTYPE;
  v_trip_status   text;
  v_respondent_id uuid;
  v_label         text;
  v_existing_id   uuid;
  v_new_id        uuid;
  v_next_pos      int;
BEGIN
  IF p_poll_id IS NULL OR p_label IS NULL OR p_session_token IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_args');
  END IF;

  v_label := btrim(p_label);
  IF length(v_label) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'empty_label');
  END IF;

  -- Cap at the poll_options.label CHECK length so we don't trip the
  -- INSERT below.
  IF length(v_label) > 40 THEN
    v_label := substr(v_label, 1, 40);
  END IF;

  SELECT * INTO v_poll FROM polls WHERE id = p_poll_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'poll_not_found');
  END IF;

  IF NOT v_poll.allow_write_ins THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'write_ins_disabled');
  END IF;

  IF v_poll.status <> 'live' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'poll_not_live');
  END IF;

  SELECT status INTO v_trip_status FROM trips WHERE id = v_poll.trip_id;
  IF v_trip_status IS DISTINCT FROM 'active' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'trip_not_active');
  END IF;

  -- Anchor on the same trip the poll belongs to so a stolen token from
  -- another trip can't write into this one.
  SELECT id INTO v_respondent_id
  FROM respondents
  WHERE trip_id = v_poll.trip_id
    AND session_token = p_session_token
  LIMIT 1;

  IF v_respondent_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_session');
  END IF;

  -- Case-insensitive dedupe — two people typing "Bali" should land on
  -- one option, not two.
  SELECT id INTO v_existing_id
  FROM poll_options
  WHERE poll_id = p_poll_id
    AND lower(btrim(label)) = lower(v_label)
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'option_id', v_existing_id, 'deduped', true);
  END IF;

  SELECT COALESCE(MAX(position), -1) + 1 INTO v_next_pos
  FROM poll_options WHERE poll_id = p_poll_id;

  INSERT INTO poll_options (poll_id, label, position)
  VALUES (p_poll_id, v_label, v_next_pos)
  RETURNING id INTO v_new_id;

  RETURN jsonb_build_object('ok', true, 'option_id', v_new_id, 'deduped', false);
END;
$$;

GRANT EXECUTE ON FUNCTION submit_poll_write_in(uuid, text, text) TO anon, authenticated;
