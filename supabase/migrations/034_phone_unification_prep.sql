-- ============================================================
-- Migration 034: Phone Unification Prep (Phase 0)
--
-- Prerequisites for the unified SMS ↔ survey ↔ app journey:
-- 1. `normalize_phone(text)` SQL function mirroring the TS version in
--    `supabase/functions/_sms-shared/phone.ts` and `src/lib/phone.ts`.
--    Used by RLS policies, backfill, and future claim/link RPCs.
-- 2. `users.auth_user_id` column + unique partial index + self-select
--    RLS policy. Links an SMS-side phone identity to an authenticated
--    app user when the claim flow (Phase 3) runs.
-- 3. One-time backfill: link existing profiles to existing users rows
--    by normalized phone match. Runs the same merge the claim RPC will
--    do later, but for the already-signed-up cohort.
-- 4. Partial unique index on `trip_sessions(trip_id)` for live phases —
--    prevents Phase 4 ("get Rally to run this in my group") from
--    creating duplicate pending sessions on repeated taps.
--
-- Fully idempotent; safe to re-run.
-- ============================================================


-- ─── 1. normalize_phone SQL function ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION normalize_phone(raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  stripped text;
  digits_only text;
BEGIN
  IF raw IS NULL OR raw = '' THEN
    RETURN NULL;
  END IF;

  -- Strip everything except digits and leading +
  stripped := regexp_replace(raw, '[^\d+]', '', 'g');

  -- Already E.164 with country code +1 (US/CA)
  IF stripped ~ '^\+1\d{10}$' THEN
    RETURN stripped;
  END IF;

  -- Has +country but not +1 — accept as-is if it looks valid (international)
  IF stripped ~ '^\+\d{7,15}$' THEN
    RETURN stripped;
  END IF;

  -- 11 digits starting with 1 (US/CA without +)
  digits_only := replace(stripped, '+', '');
  IF digits_only ~ '^1\d{10}$' THEN
    RETURN '+' || digits_only;
  END IF;

  -- 10 digits (US/CA without country code)
  IF digits_only ~ '^\d{10}$' THEN
    RETURN '+1' || digits_only;
  END IF;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION normalize_phone(text) IS
  'E.164 normalization (US/CA: +1XXXXXXXXXX). Returns NULL if unparseable. Mirror of supabase/functions/_sms-shared/phone.ts and src/lib/phone.ts.';


-- ─── 2. users.auth_user_id column ────────────────────────────────────────────

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS auth_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- One claimed auth user ↔ one SMS user row. Partial so existing NULL rows
-- don't clash.
CREATE UNIQUE INDEX IF NOT EXISTS users_auth_user_id_unique
  ON users(auth_user_id)
  WHERE auth_user_id IS NOT NULL;

-- Self-select: once claimed, the authenticated user can read their own row.
-- (Writes remain service-role-only; claim RPC is SECURITY DEFINER.)
DO $$ BEGIN
  CREATE POLICY "users_self_select" ON users
    FOR SELECT USING (auth_user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ─── 3. One-time backfill ────────────────────────────────────────────────────
--
-- For every profile with a phone that normalizes to an existing users.phone
-- and where that users row has no auth_user_id yet, link them. This covers
-- the cohort who signed up in the app before the claim flow existed.

UPDATE users u
SET auth_user_id = p.id,
    rally_account = true,
    updated_at = now()
FROM profiles p
WHERE p.phone IS NOT NULL
  AND normalize_phone(p.phone) = u.phone
  AND u.auth_user_id IS NULL;

-- Also backfill trip_members for those newly-linked users, so they
-- immediately see SMS-planned trips in "My Trips" without re-claiming.
INSERT INTO trip_members (trip_id, user_id, role)
SELECT DISTINCT ts.trip_id, u.auth_user_id, 'member'
FROM trip_session_participants tsp
JOIN trip_sessions ts ON ts.id = tsp.trip_session_id
JOIN users u ON u.id = tsp.user_id
WHERE u.auth_user_id IS NOT NULL
  AND ts.trip_id IS NOT NULL
ON CONFLICT (trip_id, user_id) DO NOTHING;

-- Same for survey respondents.
INSERT INTO trip_members (trip_id, user_id, role)
SELECT DISTINCT r.trip_id, u.auth_user_id, 'member'
FROM respondents r
JOIN users u ON u.id = r.user_id
WHERE u.auth_user_id IS NOT NULL
  AND r.trip_id IS NOT NULL
ON CONFLICT (trip_id, user_id) DO NOTHING;


-- ─── 4. trip_sessions idempotency guard (prep for Phase 4) ───────────────────
--
-- When the app offers "get Rally to run this in my group," repeated taps
-- must not create duplicate pending sessions for the same trip.

CREATE UNIQUE INDEX IF NOT EXISTS trip_sessions_trip_id_live_unique
  ON trip_sessions(trip_id)
  WHERE status IN ('ACTIVE', 'PAUSED', 'RE_ENGAGEMENT_PENDING')
    AND trip_id IS NOT NULL;
