-- ============================================================
-- Migration 039: 1:1 SMS pivot foundations
--
-- Phase 1 of the group-MMS → 1:1 DM orchestration pivot. Adds the
-- schema needed for Rally to invite participants via a public join
-- link instead of relying on group MMS routing.
--
-- See: session-1to1-pivot-handoff.md, .claude/plans/synchronous-stargazing-avalanche.md
--
-- Idempotent — safe to re-run.
-- ============================================================


-- ─── 1. Relax thread_id constraint on trip_sessions ──────────────────────────
-- Under the 1:1 model a session is keyed by trip_id + planner_user_id, not
-- by a single group thread. Existing rows keep their thread_ids; new
-- sessions created from in-app or join-link flows leave thread_id null.

ALTER TABLE trip_sessions ALTER COLUMN thread_id DROP NOT NULL;

-- Drop the UNIQUE constraint on thread_id so multiple null rows can
-- coexist. (UNIQUE was added in 026.) The partial index below preserves
-- the dedup intent for non-null thread_ids (legacy group sessions, plus
-- the app_pending_<tripId> handoff flow until that is retired in Phase 2).
ALTER TABLE trip_sessions DROP CONSTRAINT IF EXISTS trip_sessions_thread_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS trip_sessions_thread_id_unique
  ON trip_sessions(thread_id) WHERE thread_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_trip_sessions_trip_id ON trip_sessions(trip_id);


-- ─── 2. Attendance flag on participants ──────────────────────────────────────
-- Separates "owns the trip session" (is_planner) from "going on the trip"
-- (is_attending). A planner who isn't attending stays is_planner=true and
-- can flip is_attending=false without dropping out.

ALTER TABLE trip_session_participants
  ADD COLUMN IF NOT EXISTS is_attending boolean NOT NULL DEFAULT true;


-- ─── 3. Trip-model tag on sessions for telemetry split ───────────────────────
-- Lets us split metrics by old vs new during dual-running. New rows
-- default to '1to1'. Existing test sessions are wiped before launch
-- (handoff risk #10) so the default is safe.

ALTER TABLE trip_sessions
  ADD COLUMN IF NOT EXISTS trip_model text NOT NULL DEFAULT '1to1';


-- ─── 4. join_links — short shareable codes ───────────────────────────────────

CREATE TABLE IF NOT EXISTS join_links (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_session_id     uuid NOT NULL REFERENCES trip_sessions(id) ON DELETE CASCADE,
  code                text NOT NULL UNIQUE,                            -- 8 chars, base32 (no I/O/0/1)
  created_by_user_id  uuid REFERENCES users(id),
  expires_at          timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  max_uses            int NOT NULL DEFAULT 50,
  use_count           int NOT NULL DEFAULT 0,
  revoked_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_join_links_code ON join_links(code);
CREATE INDEX IF NOT EXISTS idx_join_links_session ON join_links(trip_session_id);


-- ─── 5. join_link_submissions — pending submissions awaiting SMS YES ─────────

CREATE TABLE IF NOT EXISTS join_link_submissions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  join_link_id           uuid NOT NULL REFERENCES join_links(id) ON DELETE CASCADE,
  phone                  text NOT NULL,                                -- E.164, normalized
  display_name           text NOT NULL,
  email                  text,                                         -- optional
  status                 text NOT NULL DEFAULT 'pending',              -- pending|confirmed|declined|expired
  confirmation_sent_at   timestamptz,
  confirmed_at           timestamptz,
  declined_at            timestamptz,
  expires_at             timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  ip_hash                text,                                         -- sha256(ip + UTC-day)
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_jls_phone_status ON join_link_submissions(phone, status);
CREATE INDEX IF NOT EXISTS idx_jls_link ON join_link_submissions(join_link_id);
-- Hot path: latest pending submission for inbound YES match
CREATE INDEX IF NOT EXISTS idx_jls_pending_phone
  ON join_link_submissions(phone, created_at DESC)
  WHERE status = 'pending';


-- ─── 6. RLS ──────────────────────────────────────────────────────────────────

ALTER TABLE join_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE join_link_submissions ENABLE ROW LEVEL SECURITY;

-- join_links: anon can SELECT (the public form needs the code lookup).
-- Writes go through SECURITY DEFINER RPCs only.
DO $$ BEGIN
  CREATE POLICY "join_links_public_read" ON join_links
    FOR SELECT TO anon, authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- join_link_submissions: no public policies. Writes via submit_join_link
-- (SECURITY DEFINER), reads via service-role only.


-- ─── 7. submit_join_link RPC ─────────────────────────────────────────────────
-- Anon-callable. Validates code, normalizes phone, dedups, inserts pending
-- submission. The sms-join-submit edge function calls this and then sends
-- the confirmation SMS.

CREATE OR REPLACE FUNCTION submit_join_link(
  p_code         text,
  p_phone        text,
  p_display_name text,
  p_email        text DEFAULT NULL,
  p_ip_hash      text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link             join_links%ROWTYPE;
  v_phone            text;
  v_submission       uuid;
  v_existing_active  uuid;
  v_recent_count     int;
BEGIN
  -- Validate code
  SELECT * INTO v_link FROM join_links WHERE code = p_code;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_code');
  END IF;
  IF v_link.revoked_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'revoked');
  END IF;
  IF v_link.expires_at < now() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'expired');
  END IF;
  IF v_link.use_count >= v_link.max_uses THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'capacity_reached');
  END IF;

  -- Normalize phone
  v_phone := normalize_phone(p_phone);
  IF v_phone IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_phone');
  END IF;

  -- Already active on this session? Short-circuit.
  SELECT id INTO v_existing_active
  FROM trip_session_participants
  WHERE trip_session_id = v_link.trip_session_id
    AND phone = v_phone
    AND status = 'active'
  LIMIT 1;
  IF v_existing_active IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'reason', 'already_joined',
                              'submission_id', NULL);
  END IF;

  -- Per-phone-per-link dedup: reuse the latest pending row if it exists
  SELECT id INTO v_submission
  FROM join_link_submissions
  WHERE join_link_id = v_link.id
    AND phone = v_phone
    AND status = 'pending'
    AND expires_at > now()
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_submission IS NOT NULL THEN
    -- Refresh contact fields, leave timestamps as-is so refreshes don't
    -- re-send SMS. Edge function checks confirmation_sent_at.
    UPDATE join_link_submissions
    SET    display_name = p_display_name,
           email        = COALESCE(p_email, email),
           ip_hash      = COALESCE(p_ip_hash, ip_hash)
    WHERE  id = v_submission;
    RETURN jsonb_build_object('ok', true, 'reason', 'duplicate',
                              'submission_id', v_submission);
  END IF;

  -- Per-IP rate limit: max 10 pending submissions per ip_hash per hour
  IF p_ip_hash IS NOT NULL THEN
    SELECT count(*) INTO v_recent_count
    FROM join_link_submissions
    WHERE ip_hash = p_ip_hash
      AND created_at > now() - interval '1 hour';
    IF v_recent_count >= 10 THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'rate_limited');
    END IF;
  END IF;

  INSERT INTO join_link_submissions (
    join_link_id, phone, display_name, email, ip_hash
  ) VALUES (
    v_link.id, v_phone, p_display_name, p_email, p_ip_hash
  ) RETURNING id INTO v_submission;

  RETURN jsonb_build_object('ok', true, 'reason', 'created',
                            'submission_id', v_submission);
END;
$$;

GRANT EXECUTE ON FUNCTION submit_join_link(text, text, text, text, text)
  TO anon, authenticated;


-- ─── 8. get_join_link_preview RPC ────────────────────────────────────────────
-- Anon-callable. Returns the data the join page renders (planner name,
-- destination, who's already joined). NEVER returns phone numbers.

CREATE OR REPLACE FUNCTION get_join_link_preview(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link          join_links%ROWTYPE;
  v_session       trip_sessions%ROWTYPE;
  v_planner_name  text;
  v_member_names  text[];
BEGIN
  SELECT * INTO v_link FROM join_links WHERE code = p_code;
  IF NOT FOUND OR v_link.revoked_at IS NOT NULL OR v_link.expires_at < now() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_or_expired');
  END IF;

  SELECT * INTO v_session FROM trip_sessions WHERE id = v_link.trip_session_id;

  SELECT u.display_name INTO v_planner_name
  FROM users u WHERE u.id = v_session.planner_user_id;

  SELECT array_agg(p.display_name ORDER BY p.joined_at)
  INTO v_member_names
  FROM trip_session_participants p
  WHERE p.trip_session_id = v_link.trip_session_id
    AND p.status = 'active'
    AND p.display_name IS NOT NULL;

  RETURN jsonb_build_object(
    'ok', true,
    'planner_name',  v_planner_name,
    'destination',   v_session.destination,
    'dates',         v_session.dates,
    'joined_names',  COALESCE(v_member_names, ARRAY[]::text[]),
    'member_count',  COALESCE(array_length(v_member_names, 1), 0)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_join_link_preview(text) TO anon, authenticated;


-- ─── 9. confirm_join_submission RPC ──────────────────────────────────────────
-- Service-role only. Called by sms-inbound when a pending submission's
-- phone replies YES (or NO/STOP). Promotes to participant on confirm,
-- bumps join_links.use_count, returns trip_session_id so the inbound
-- handler can route the kickoff SMS.

CREATE OR REPLACE FUNCTION confirm_join_submission(p_phone text, p_decision text)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_phone           text;
  v_submission      join_link_submissions%ROWTYPE;
  v_link            join_links%ROWTYPE;
  v_user_id         uuid;
  v_participant_id  uuid;
  v_planner_name    text;
  v_destination     text;
BEGIN
  v_phone := normalize_phone(p_phone);
  IF v_phone IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_phone');
  END IF;

  -- Latest pending submission for this phone (across any join link).
  SELECT * INTO v_submission
  FROM join_link_submissions
  WHERE phone = v_phone AND status = 'pending' AND expires_at > now()
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_pending');
  END IF;

  IF p_decision = 'declined' THEN
    UPDATE join_link_submissions
    SET status = 'declined', declined_at = now()
    WHERE id = v_submission.id;
    RETURN jsonb_build_object('ok', true, 'reason', 'declined');
  END IF;

  SELECT * INTO v_link FROM join_links WHERE id = v_submission.join_link_id FOR UPDATE;
  IF v_link.use_count >= v_link.max_uses OR v_link.revoked_at IS NOT NULL THEN
    UPDATE join_link_submissions SET status = 'expired' WHERE id = v_submission.id;
    RETURN jsonb_build_object('ok', false, 'reason', 'link_exhausted');
  END IF;

  -- find_or_create users row by phone
  SELECT id INTO v_user_id FROM users WHERE phone = v_phone;
  IF v_user_id IS NULL THEN
    INSERT INTO users (phone, display_name, rally_account, trip_count, opted_out)
    VALUES (v_phone, v_submission.display_name, false, 0, false)
    RETURNING id INTO v_user_id;
  ELSE
    UPDATE users SET display_name = COALESCE(display_name, v_submission.display_name)
    WHERE id = v_user_id;
  END IF;

  -- Promote to participant (idempotent on (trip_session_id, phone))
  INSERT INTO trip_session_participants (
    trip_session_id, user_id, phone, display_name, status, is_attending, is_planner
  )
  VALUES (
    v_link.trip_session_id, v_user_id, v_phone, v_submission.display_name,
    'active', true, false
  )
  ON CONFLICT (trip_session_id, phone) DO UPDATE
    SET status     = 'active',
        is_attending = true,
        display_name = EXCLUDED.display_name,
        updated_at = now()
  RETURNING id INTO v_participant_id;

  UPDATE join_link_submissions
  SET status = 'confirmed', confirmed_at = now()
  WHERE id = v_submission.id;

  UPDATE join_links SET use_count = use_count + 1 WHERE id = v_link.id;

  -- Pull planner + destination for the kickoff SMS the caller will send.
  SELECT u.display_name, ts.destination
  INTO   v_planner_name, v_destination
  FROM   trip_sessions ts
  LEFT JOIN users u ON u.id = ts.planner_user_id
  WHERE  ts.id = v_link.trip_session_id;

  RETURN jsonb_build_object(
    'ok',                true,
    'reason',            'confirmed',
    'trip_session_id',   v_link.trip_session_id,
    'participant_id',    v_participant_id,
    'user_id',           v_user_id,
    'display_name',      v_submission.display_name,
    'planner_name',      v_planner_name,
    'destination',       v_destination
  );
END;
$$;
-- No GRANT — service-role only.


-- ─── 10. create_join_link RPC ────────────────────────────────────────────────
-- Authenticated callers create a join link for a trip session they own
-- (planner_user_id matches their auth_user_id linkage) or are a member of.
-- Generates a Crockford-base32 code (8 chars, no I/O/0/1) for SMS-friendly
-- typing.

CREATE OR REPLACE FUNCTION create_join_link(p_trip_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid           uuid;
  v_session       trip_sessions%ROWTYPE;
  v_users_id      uuid;
  v_authorized    boolean := false;
  v_code          text;
  v_link_id       uuid;
  v_attempts      int := 0;
  -- Crockford base32 minus I/O/0/1 to avoid SMS-typing ambiguity
  v_alphabet      text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_random_bytes  bytea;
  v_b             int;
  v_i             int;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  SELECT * INTO v_session FROM trip_sessions WHERE id = p_trip_session_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'session_not_found');
  END IF;

  -- Authorize: caller must be the planner (via auth_user_id ↔ users.id)
  -- or a trip_member of the underlying trip.
  SELECT id INTO v_users_id FROM users WHERE auth_user_id = v_uid LIMIT 1;
  IF v_users_id IS NOT NULL AND v_users_id = v_session.planner_user_id THEN
    v_authorized := true;
  ELSIF v_session.trip_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM trip_members tm
      WHERE tm.trip_id = v_session.trip_id AND tm.user_id = v_uid
    ) INTO v_authorized;
  END IF;

  IF NOT v_authorized THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  -- Generate a unique 8-char code. Retry on (extremely unlikely) collision.
  LOOP
    v_code := '';
    v_random_bytes := gen_random_bytes(8);
    FOR v_i IN 0..7 LOOP
      v_b := get_byte(v_random_bytes, v_i) % 32;
      v_code := v_code || substr(v_alphabet, v_b + 1, 1);
    END LOOP;

    BEGIN
      INSERT INTO join_links (trip_session_id, code, created_by_user_id)
      VALUES (p_trip_session_id, v_code, v_users_id)
      RETURNING id INTO v_link_id;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      v_attempts := v_attempts + 1;
      IF v_attempts >= 5 THEN
        RAISE EXCEPTION 'join_link_code_collision';
      END IF;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'ok',       true,
    'link_id',  v_link_id,
    'code',     v_code
  );
END;
$$;

GRANT EXECUTE ON FUNCTION create_join_link(uuid) TO authenticated;
