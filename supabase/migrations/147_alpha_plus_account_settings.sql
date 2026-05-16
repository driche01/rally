-- ============================================================
-- Migration 147: account settings (calendar sync + filter prefs)
--
-- Adds per-profile columns that back the Account / Calendar Sync
-- tabs in the new <SettingsModal>:
--
--   - calendar_token            : stable secret token used in the
--                                 public ICS feed URL. Anyone with
--                                 the token can subscribe to the
--                                 feed (it's the credential), so
--                                 it's unguessable. Rotatable from
--                                 the settings UI later.
--   - calendar_include_going    : include trips where I RSVPed
--                                 going OR I'm hosting/cohosting.
--                                 Default true.
--   - calendar_include_maybe    : include trips where I RSVPed
--                                 maybe. Default true.
--   - calendar_include_invited  : include trips where I'm on the
--                                 respondent list but haven't yet
--                                 RSVPed. Default false (most
--                                 people don't want speculative
--                                 events on their calendar).
--
-- Backfill: every existing profile gets a calendar_token generated
-- via gen_random_uuid(); defaults handle the booleans.
--
-- All additive — no drops, no NOT NULL flips on existing columns.
-- ============================================================

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS calendar_token            uuid    NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS calendar_include_going    boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS calendar_include_maybe    boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS calendar_include_invited  boolean NOT NULL DEFAULT false;

-- The DEFAULT only fires for new rows; backfill existing ones with
-- a fresh uuid each.
UPDATE profiles
SET calendar_token = gen_random_uuid()
WHERE calendar_token IS NULL;

-- Lookup index — the public ICS endpoint reads by calendar_token.
CREATE INDEX IF NOT EXISTS profiles_calendar_token_idx
  ON profiles(calendar_token);

INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES ('147', 'alpha_plus_account_settings', ARRAY[]::text[])
ON CONFLICT (version) DO NOTHING;
