-- ============================================================
-- Migration 046: Schedule the nudge scheduler cron
--
-- Runs the sms-nudge-scheduler edge function every 15 minutes. The
-- function handles two passes per tick:
--   1. SEED — top off nudge_sends rows for any active session
--   2. FIRE — send any due, unfired nudges
--
-- Both passes are idempotent. The unique partial index on
-- (trip_session_id, participant_id, nudge_type) WHERE sent_at IS NULL
-- AND skipped_at IS NULL prevents duplicate seeds. The fire pass uses
-- per-row idempotency keys so a re-run of the same row never doubles up.
--
-- Migration 042 unscheduled the legacy 'sms-nudge-every-10min' job; we
-- pick a distinct name to avoid any cron-table collision and to make
-- it unambiguous in pg_cron logs that this is the new survey-cadence
-- scheduler, not the old conversational-phase scheduler.
-- ============================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sms-nudge-scheduler-every-15min') THEN
    PERFORM cron.unschedule('sms-nudge-scheduler-every-15min');
  END IF;
END
$$;

SELECT cron.schedule(
  'sms-nudge-scheduler-every-15min',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://qxpbnixvjtwckuedlrfj.supabase.co/functions/v1/sms-nudge-scheduler',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ***SCRUBBED-SUPABASE-SERVICE-ROLE-KEY***'
    ),
    body    := '{}'::jsonb
  );
  $$
);
