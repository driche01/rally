-- ============================================================
-- Migration 042: Drop sms-nudge-scheduler cron
--
-- The Phase 5.6 kill-switch retired Rally's conversational SMS surface,
-- which means there are no more SMS sessions for the nudge scheduler to
-- nudge. The edge function was deleted in the same cleanup. This
-- migration unschedules the cron entry so we stop hitting a 404 every
-- 10 minutes.
--
-- Idempotent: cron.unschedule throws when the job doesn't exist, so
-- guard with EXISTS.
-- ============================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sms-nudge-every-10min') THEN
    PERFORM cron.unschedule('sms-nudge-every-10min');
  END IF;
END
$$;
