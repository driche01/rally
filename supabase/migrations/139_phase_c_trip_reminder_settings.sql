-- ============================================================
-- Migration 139: Phase C — trip_reminder_settings
--
-- Per-trip on/off toggles for the 5 auto-reminder types.
-- Hosts can disable any auto reminder via the reminder-settings
-- panel; toggle defaults match the build guide.
--
-- PK = trip_id (one row per trip max). A trip without a row uses
-- the defaults (all enabled).
-- ============================================================

CREATE TABLE IF NOT EXISTS trip_reminder_settings (
  trip_id                      uuid PRIMARY KEY REFERENCES trips(id) ON DELETE CASCADE,
  rsvp_nudge_enabled           boolean NOT NULL DEFAULT true,
  profile_completion_enabled   boolean NOT NULL DEFAULT true,
  booking_nudge_enabled        boolean NOT NULL DEFAULT true,
  pre_trip_summary_enabled     boolean NOT NULL DEFAULT true,
  re_engagement_enabled        boolean NOT NULL DEFAULT true,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  updated_at                   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE trip_reminder_settings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='trip_reminder_settings' AND policyname='trs_host_all') THEN
    CREATE POLICY trs_host_all ON trip_reminder_settings FOR ALL
      USING (
        EXISTS (SELECT 1 FROM trips t WHERE t.id = trip_reminder_settings.trip_id AND t.created_by = auth.uid())
        OR EXISTS (SELECT 1 FROM trip_cohosts c WHERE c.trip_id = trip_reminder_settings.trip_id AND c.user_id = auth.uid())
      )
      WITH CHECK (
        EXISTS (SELECT 1 FROM trips t WHERE t.id = trip_reminder_settings.trip_id AND t.created_by = auth.uid())
        OR EXISTS (SELECT 1 FROM trip_cohosts c WHERE c.trip_id = trip_reminder_settings.trip_id AND c.user_id = auth.uid())
      );
  END IF;
END$$;

INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES ('139', 'phase_c_trip_reminder_settings', ARRAY[]::text[])
ON CONFLICT (version) DO NOTHING;
