-- ============================================================
-- Migration 036: Survey ↔ users linkage (Phase 2)
--
-- When someone responds to a survey at /respond/[tripId], today the
-- client inserts a row into `respondents` but never touches the
-- phone-keyed `users` table — so a survey-only respondent is invisible
-- to the future Phase 3 claim flow.
--
-- This RPC mirrors the SMS-side `findOrCreateUser` + `ensureRespondent`
-- pair (`supabase/functions/_sms-shared/phone-user-linker.ts`) but in
-- SQL, with SECURITY DEFINER so anon survey visitors can call it
-- without `users` being exposed to the public role.
--
-- After this migration:
--   - A phone that only responded to a web survey gets a `users` row.
--   - Their `respondents.user_id` points at it.
--   - When that phone later signs up in the app, the Phase 3 claim
--     flow can find and merge their survey-respondent trips.
-- ============================================================

CREATE OR REPLACE FUNCTION ensure_respondent_user(
  p_trip_id           uuid,
  p_phone             text,
  p_name              text,
  p_email             text DEFAULT NULL,
  p_session_token     text DEFAULT NULL,
  p_existing_respondent_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_normalized_phone text;
  v_user_id          uuid;
  v_respondent_id    uuid;
  v_session_token    text;
  v_was_new          boolean := false;
  v_existing_row     respondents%ROWTYPE;
BEGIN
  -- ─── Normalize phone (caller already normalized but be defensive) ──
  v_normalized_phone := normalize_phone(p_phone);
  IF v_normalized_phone IS NULL THEN
    RAISE EXCEPTION 'invalid_phone' USING ERRCODE = '22023';
  END IF;

  -- ─── Find or create users row by phone ─────────────────────────────
  -- users.phone is UNIQUE, so the (rare) race where two anon clients
  -- submit the same phone simultaneously falls through to the SELECT
  -- below.
  SELECT id INTO v_user_id FROM users WHERE phone = v_normalized_phone;
  IF v_user_id IS NULL THEN
    BEGIN
      INSERT INTO users (phone, display_name, rally_account, trip_count, opted_out)
      VALUES (v_normalized_phone, p_name, false, 0, false)
      RETURNING id INTO v_user_id;
    EXCEPTION WHEN unique_violation THEN
      SELECT id INTO v_user_id FROM users WHERE phone = v_normalized_phone;
    END;
  ELSE
    -- Update display_name only when we have a real one and the existing
    -- row has none (mirrors SMS-side behavior — never overwrite an
    -- already-set display name from the survey).
    UPDATE users
    SET    display_name = COALESCE(display_name, p_name),
           updated_at   = now()
    WHERE  id = v_user_id;
  END IF;

  -- ─── Caller already has a respondent row (token match) ─────────────
  -- Backfill its user_id link + freshen contact fields. Don't change
  -- session_token — caller wants to preserve their per-trip token.
  IF p_existing_respondent_id IS NOT NULL THEN
    SELECT * INTO v_existing_row FROM respondents WHERE id = p_existing_respondent_id;
    IF FOUND THEN
      UPDATE respondents
      SET    user_id = COALESCE(user_id, v_user_id),
             name    = CASE WHEN p_name IS NOT NULL AND p_name <> '' THEN p_name ELSE name END,
             email   = COALESCE(p_email, email),
             phone   = v_normalized_phone
      WHERE  id = p_existing_respondent_id;
      RETURN jsonb_build_object(
        'respondent_id',  p_existing_respondent_id,
        'session_token',  v_existing_row.session_token,
        'was_new',        false,
        'user_id',        v_user_id
      );
    END IF;
  END IF;

  -- ─── No respondent_id supplied — find by (trip_id, phone) ──────────
  SELECT id, session_token
  INTO   v_respondent_id, v_session_token
  FROM   respondents
  WHERE  trip_id = p_trip_id AND phone = v_normalized_phone
  LIMIT  1;

  IF v_respondent_id IS NOT NULL THEN
    -- Adopt: link user_id, refresh name/email
    UPDATE respondents
    SET    user_id = COALESCE(user_id, v_user_id),
           name    = CASE WHEN p_name IS NOT NULL AND p_name <> '' THEN p_name ELSE name END,
           email   = COALESCE(p_email, email)
    WHERE  id = v_respondent_id;
  ELSE
    -- Brand new respondent
    v_session_token := COALESCE(p_session_token, gen_random_uuid()::text);
    INSERT INTO respondents (trip_id, name, phone, email, user_id, is_planner, session_token)
    VALUES (p_trip_id, COALESCE(p_name, v_normalized_phone), v_normalized_phone, p_email, v_user_id, false, v_session_token)
    RETURNING id INTO v_respondent_id;
    v_was_new := true;
  END IF;

  RETURN jsonb_build_object(
    'respondent_id',  v_respondent_id,
    'session_token',  v_session_token,
    'was_new',        v_was_new,
    'user_id',        v_user_id
  );
END;
$$;

COMMENT ON FUNCTION ensure_respondent_user IS
  'Survey-side mirror of SMS findOrCreateUser+ensureRespondent. Anon-callable via SECURITY DEFINER. Returns {respondent_id, session_token, was_new, user_id}.';

GRANT EXECUTE ON FUNCTION ensure_respondent_user(uuid, text, text, text, text, uuid) TO anon, authenticated;
