-- ============================================================
-- Migration 037: Phone-to-account claim flow (Phase 3)
--
-- After signup, if the user's phone matches an existing `users` row
-- with no `auth_user_id` yet, we OTP-confirm ownership and merge:
--   - Set users.auth_user_id = auth.uid()
--   - Insert trip_members rows for every trip they participated in
--     via SMS (trip_session_participants → trip_sessions.trip_id)
--     and via web survey (respondents.trip_id).
--
-- Identity transport: custom OTP via Rally's existing Twilio number.
-- Codes are SHA-256-hashed at rest. Edge function `claim-otp`
-- generates + sends; this RPC verifies + merges in one transactional
-- SECURITY DEFINER call.
--
-- Why custom OTP (not Supabase Auth phone-change):
--   - Scales to WhatsApp (Session A) with no Supabase Auth migration.
--   - No `[auth.sms]` config dependency in supabase/config.toml.
--   - Reuses the same Twilio number / sending reputation Rally
--     already has for the SMS agent.
-- ============================================================


-- ─── 1. phone_claim_tokens table ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS phone_claim_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone        text NOT NULL,                 -- E.164, normalized
  code_hash    text NOT NULL,                 -- sha256(phone + ':' + code) hex
  attempts     int  NOT NULL DEFAULT 0,
  expires_at   timestamptz NOT NULL,
  used_at      timestamptz,                   -- set on successful verify
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Lookup hot path: latest live token per phone
CREATE INDEX IF NOT EXISTS idx_phone_claim_tokens_phone_live
  ON phone_claim_tokens (phone, created_at DESC)
  WHERE used_at IS NULL;

-- Used for the SMS inbound short-circuit (drop 6-digit replies that
-- are clearly the OTP getting echoed back into the planning thread).
CREATE INDEX IF NOT EXISTS idx_phone_claim_tokens_active
  ON phone_claim_tokens (phone)
  WHERE used_at IS NULL;

-- RLS: anon never reads or writes these directly. Edge function uses
-- service-role; verify RPC is SECURITY DEFINER. Lock it down.
ALTER TABLE phone_claim_tokens ENABLE ROW LEVEL SECURITY;
-- (No policies → only service-role can touch the table.)


-- ─── 2. check_claim_available(phone) → boolean ────────────────────────────────
--
-- Cheap, anon-callable check the app fires after signup to decide whether
-- to even prompt the user with the OTP claim screen. Returns true iff
-- there's an unclaimed `users` row matching the normalized phone.

CREATE OR REPLACE FUNCTION check_claim_available(p_phone text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_normalized text;
BEGIN
  v_normalized := normalize_phone(p_phone);
  IF v_normalized IS NULL THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM   users
    WHERE  phone = v_normalized
      AND  auth_user_id IS NULL
  );
END;
$$;

GRANT EXECUTE ON FUNCTION check_claim_available(text) TO authenticated, anon;


-- ─── 3. has_active_claim_token(phone) → boolean ──────────────────────────────
--
-- Used by the SMS inbound processor's short-circuit: if a 6-digit
-- message lands from a phone with a live un-used token, drop it
-- silently (it's the OTP being echoed back into the planning thread,
-- not a destination/budget answer).

CREATE OR REPLACE FUNCTION has_active_claim_token(p_phone text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_normalized text;
BEGIN
  v_normalized := normalize_phone(p_phone);
  IF v_normalized IS NULL THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM   phone_claim_tokens
    WHERE  phone = v_normalized
      AND  used_at IS NULL
      AND  expires_at > now()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION has_active_claim_token(text) TO authenticated, anon;


-- ─── 4. claim_account_with_otp(phone, code) → jsonb ──────────────────────────
--
-- Single transactional RPC: verify OTP, mark consumed, merge SMS +
-- survey trip history into trip_members for the calling auth user.
-- Reads `auth.uid()` internally — never accept an auth_user_id as a
-- parameter (#1 SECURITY DEFINER footgun).
--
-- Returns: jsonb {
--   ok:           boolean,
--   reason:       text | null    -- 'ok' | 'invalid_code' | 'expired' | 'too_many_attempts' | 'no_match' | 'not_authenticated'
--   trips_added:  int            -- count of newly-inserted trip_members rows (SMS + survey unioned)
-- }

CREATE OR REPLACE FUNCTION claim_account_with_otp(p_phone text, p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid              uuid;
  v_normalized       text;
  v_token            phone_claim_tokens%ROWTYPE;
  v_expected_hash    text;
  v_users_id         uuid;
  v_trips_added_sms  int := 0;
  v_trips_added_resp int := 0;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated', 'trips_added', 0);
  END IF;

  v_normalized := normalize_phone(p_phone);
  IF v_normalized IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_code', 'trips_added', 0);
  END IF;

  -- Latest un-used token for this phone (lock it).
  SELECT *
  INTO   v_token
  FROM   phone_claim_tokens
  WHERE  phone = v_normalized
    AND  used_at IS NULL
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_code', 'trips_added', 0);
  END IF;

  IF v_token.expires_at < now() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'expired', 'trips_added', 0);
  END IF;

  IF v_token.attempts >= 5 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'too_many_attempts', 'trips_added', 0);
  END IF;

  -- Hash format must match the edge function's (sha256(phone:code) hex).
  v_expected_hash := encode(digest(v_normalized || ':' || p_code, 'sha256'), 'hex');
  IF v_expected_hash <> v_token.code_hash THEN
    UPDATE phone_claim_tokens SET attempts = attempts + 1 WHERE id = v_token.id;
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_code', 'trips_added', 0);
  END IF;

  -- Mark token consumed. Even if the merge below is a no-op (no
  -- matching unclaimed users row), we burn the token so attackers
  -- can't replay.
  UPDATE phone_claim_tokens SET used_at = now() WHERE id = v_token.id;

  -- Find the unclaimed users row (if any). Lock it.
  SELECT id
  INTO   v_users_id
  FROM   users
  WHERE  phone = v_normalized
    AND  auth_user_id IS NULL
  FOR UPDATE;

  IF v_users_id IS NULL THEN
    -- Successful verify but no SMS/survey history to claim — still ok.
    RETURN jsonb_build_object('ok', true, 'reason', 'no_match', 'trips_added', 0);
  END IF;

  -- Link the auth user.
  UPDATE users
  SET    auth_user_id  = v_uid,
         rally_account = true,
         updated_at    = now()
  WHERE  id = v_users_id;

  -- Backfill trip_members from SMS participation.
  WITH inserted AS (
    INSERT INTO trip_members (trip_id, user_id, role)
    SELECT DISTINCT ts.trip_id, v_uid, 'member'
    FROM   trip_session_participants tsp
    JOIN   trip_sessions ts ON ts.id = tsp.trip_session_id
    WHERE  tsp.user_id = v_users_id
      AND  ts.trip_id IS NOT NULL
    ON CONFLICT (trip_id, user_id) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_trips_added_sms FROM inserted;

  -- Backfill trip_members from survey participation.
  WITH inserted AS (
    INSERT INTO trip_members (trip_id, user_id, role)
    SELECT DISTINCT r.trip_id, v_uid, 'member'
    FROM   respondents r
    WHERE  r.user_id = v_users_id
      AND  r.trip_id IS NOT NULL
    ON CONFLICT (trip_id, user_id) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_trips_added_resp FROM inserted;

  RETURN jsonb_build_object(
    'ok', true,
    'reason', 'ok',
    'trips_added', v_trips_added_sms + v_trips_added_resp
  );
END;
$$;

-- pgcrypto provides digest(); ensure it's enabled.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

GRANT EXECUTE ON FUNCTION claim_account_with_otp(text, text) TO authenticated;
