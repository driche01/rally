-- ============================================================
-- Migration 136: Phase C — scheduled_reminders
--
-- Per-recipient queue for future SMS that fire from the polyglot
-- scheduler (Q22). One row per (trip × recipient × reminder type).
--
-- FK targets per build review:
--   recipient_respondent_id → respondents(id)         (Q18)
--   sent_thread_message_id  → thread_messages(id)     (Q19)
--
-- message_type matches the app-layer set Phase C adds to
-- thread_messages.message_type. No CHECK on thread_messages
-- (matches Q6 convention there); we DO put a CHECK here because
-- a typo would silently drop a reminder.
-- ============================================================

CREATE TABLE IF NOT EXISTS scheduled_reminders (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id                  uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  recipient_respondent_id  uuid NOT NULL REFERENCES respondents(id) ON DELETE CASCADE,
  message_type             text NOT NULL,
  scheduled_for            timestamptz NOT NULL,
  status                   text NOT NULL DEFAULT 'pending',
  sent_thread_message_id   uuid NULL REFERENCES thread_messages(id),
  attempted_at             timestamptz NULL,
  skip_reason              text NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scheduled_reminders_status_check
    CHECK (status IN ('pending','sent','cancelled','skipped')),
  CONSTRAINT scheduled_reminders_message_type_check
    CHECK (message_type IN (
      'rsvp_nudge',
      'profile_completion_nudge',
      'booking_nudge',
      'pre_trip_summary',
      're_engagement'
    ))
);

-- Cron hot path: "any reminder due to fire now?"
CREATE INDEX IF NOT EXISTS idx_scheduled_reminders_due
  ON scheduled_reminders (scheduled_for, status)
  WHERE status = 'pending';

-- Cancellation lookups when the triggering condition resolves.
CREATE INDEX IF NOT EXISTS idx_scheduled_reminders_trip_type
  ON scheduled_reminders (trip_id, message_type);

-- Dedupe: never schedule two pending reminders of the same
-- type to the same recipient on the same trip.
CREATE UNIQUE INDEX IF NOT EXISTS idx_scheduled_reminders_unique_pending
  ON scheduled_reminders (trip_id, recipient_respondent_id, message_type)
  WHERE status = 'pending';

ALTER TABLE scheduled_reminders ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='scheduled_reminders' AND policyname='sched_rem_host_select') THEN
    CREATE POLICY sched_rem_host_select ON scheduled_reminders FOR SELECT
      USING (
        EXISTS (SELECT 1 FROM trips t WHERE t.id = scheduled_reminders.trip_id AND t.created_by = auth.uid())
        OR EXISTS (SELECT 1 FROM trip_cohosts c WHERE c.trip_id = scheduled_reminders.trip_id AND c.user_id = auth.uid())
      );
  END IF;
END$$;

-- No INSERT/UPDATE policy: writes happen only via the service-role
-- worker (scheduler edge function). Host UI can cancel via an API
-- route that uses the service-role client.

INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES ('136', 'phase_c_scheduled_reminders', ARRAY[]::text[])
ON CONFLICT (version) DO NOTHING;
