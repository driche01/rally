-- ============================================================
-- Migration 108: account_exists_for_email RPC
--
-- The email-login path (supabase.auth.signInWithPassword) returns the
-- same generic "Invalid login credentials" error for both wrong-password
-- AND no-such-account. That makes it impossible to distinguish "the
-- user typed the wrong password" from "the user doesn't have an account
-- yet" — so the UX dead-ends at an unhelpful alert.
--
-- This RPC lets the login screen probe email existence after a failed
-- sign-in: if the email doesn't have an auth.users row, route the user
-- to the signup screen with their email pre-filled. Anti-enumeration
-- is intentionally dropped here at the planner's direction (better UX
-- > unverified-account enumeration risk pre-launch).
--
-- SECURITY DEFINER + grant to anon so it can be called from the
-- pre-auth login screen.
-- ============================================================

CREATE OR REPLACE FUNCTION account_exists_for_email(p_email text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF p_email IS NULL OR length(trim(p_email)) = 0 THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM auth.users
    WHERE lower(email) = lower(trim(p_email))
  );
END;
$$;

GRANT EXECUTE ON FUNCTION account_exists_for_email(text) TO authenticated, anon;

COMMENT ON FUNCTION account_exists_for_email(text) IS
  'Returns true iff an auth.users row matches the given email. Used by the login screen to redirect users who entered an unregistered email to the signup flow with the email pre-filled.';
