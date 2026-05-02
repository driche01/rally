-- ============================================================
-- Migration 110: profile trigger picks up last_name + phone from metadata
--
-- The original handle_new_user trigger (migration 001) only copied
-- raw_user_meta_data.name into profiles. Last name and phone were set
-- by a follow-up client-side upsert in useSignUp — but that upsert
-- runs as the anon role when email confirmation is required (no
-- session yet), so it fails the profiles RLS update policy and the
-- whole signup throws.
--
-- This migration teaches the trigger to also read last_name and phone
-- from raw_user_meta_data so the entire profile lands at insert time,
-- gated by the SECURITY DEFINER trigger rather than a separate
-- authenticated round-trip. The client can drop the post-signup
-- upsert entirely.
--
-- normalize_phone() is applied so however the client formats the
-- input (E.164, US-formatted, raw digits), profiles.phone lands in
-- the canonical shape every other table joins on.
-- ============================================================

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phone_raw text := NEW.raw_user_meta_data->>'phone';
  v_phone     text := nullif(normalize_phone(v_phone_raw), '');
BEGIN
  INSERT INTO profiles (id, name, last_name, email, phone)
  VALUES (
    NEW.id,
    coalesce(NEW.raw_user_meta_data->>'name', ''),
    nullif(NEW.raw_user_meta_data->>'last_name', ''),
    NEW.email,
    coalesce(v_phone, nullif(v_phone_raw, ''))
  );
  RETURN NEW;
END;
$$;

-- Trigger registration is unchanged — recreate idempotently in case
-- a future migration drops it.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
