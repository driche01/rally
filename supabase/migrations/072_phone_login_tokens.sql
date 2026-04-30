-- ============================================================
-- Migration 072: Phone-as-login-method (OTP) tokens.
--
-- Mirrors `phone_claim_tokens` (migration 037) but for the login
-- flow rather than the post-signup claim flow:
--
--   request-phone-login-otp  → row inserted here, SMS sent
--   verify-phone-login-otp   → row matched here, on success the
--                              edge function calls
--                              `auth.admin.generateLink({ magiclink })`
--                              and returns the hashed_token to the
--                              client, which mints a session via
--                              supabase.auth.verifyOtp().
--
-- We don't ship a SECURITY DEFINER RPC for verification (unlike
-- claim_account_with_otp) because verification needs the service-role
-- admin API to issue a session for an existing user — there's no
-- equivalent SQL primitive. All of it lives in the edge function.
--
-- Service-role-only access; RLS denies direct anon/authenticated reads.
-- ============================================================

CREATE TABLE IF NOT EXISTS phone_login_tokens (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  phone        text        NOT NULL,            -- E.164, normalized
  code_hash    text        NOT NULL,            -- sha256(phone + ':' + code) hex
  attempts     int         NOT NULL DEFAULT 0,
  expires_at   timestamptz NOT NULL,
  used_at      timestamptz,                     -- set on successful verify
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Lookup hot path: latest live token per phone
CREATE INDEX IF NOT EXISTS idx_phone_login_tokens_phone_live
  ON phone_login_tokens (phone, created_at DESC)
  WHERE used_at IS NULL;

-- Anon/authenticated never reads or writes these directly. Edge
-- function uses service-role; lock down via RLS-with-no-policies.
ALTER TABLE phone_login_tokens ENABLE ROW LEVEL SECURITY;

-- pgcrypto for digest() — already enabled by 037 but idempotent.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
