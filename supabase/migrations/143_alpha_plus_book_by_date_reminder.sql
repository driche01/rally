-- ============================================================
-- Migration 143: Alpha+ — book_by_date wiring + final_rsvp_reminder
--
-- Per user directive 2026-05-14:
--   • Q35: `trips.book_by_date` becomes REQUIRED at trip creation.
--          App-layer validation only (DB column stays nullable per
--          CLAUDE.md hard rule #1 — no NOT NULL toggles on existing
--          columns).
--   • Nudges re-key from start_date to book_by_date.
--   • New auto-fired reminder type 'final_rsvp_reminder' fires 7
--     days before book_by_date to invited+maybe respondents
--     (Q34 "unresponded" segment).
--
-- This migration:
--   1. Backfills book_by_date for existing trips that lack it
--      (= start_date - 30 days). Trips with no start_date are
--      skipped; planners will need to fill the field in if they
--      want reminders.
--   2. Widens scheduled_reminders.message_type CHECK to include
--      'final_rsvp_reminder'.
--   3. Adds trip_reminder_settings.final_rsvp_reminder_enabled
--      boolean default true.
--
-- All additive.
-- ============================================================

-- 1. Backfill book_by_date for existing trips.
UPDATE trips
SET book_by_date = (start_date - INTERVAL '30 days')::date
WHERE book_by_date IS NULL
  AND start_date IS NOT NULL;

-- 2. Widen the scheduled_reminders.message_type CHECK with the
--    new 'final_rsvp_reminder' value. Drop + re-add as a superset.
ALTER TABLE scheduled_reminders
  DROP CONSTRAINT IF EXISTS scheduled_reminders_message_type_check;

ALTER TABLE scheduled_reminders
  ADD CONSTRAINT scheduled_reminders_message_type_check
  CHECK (message_type IN (
    'rsvp_nudge',
    'profile_completion_nudge',
    'booking_nudge',
    'pre_trip_summary',
    're_engagement',
    'final_rsvp_reminder'
  ));

-- 3. Per-trip toggle for the new reminder type.
ALTER TABLE trip_reminder_settings
  ADD COLUMN IF NOT EXISTS final_rsvp_reminder_enabled boolean NOT NULL DEFAULT true;

INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES ('143', 'alpha_plus_book_by_date_reminder', ARRAY[]::text[])
ON CONFLICT (version) DO NOTHING;
