-- ============================================================
-- Migration 055: Move cron service-role JWT to Supabase Vault
--
-- Migration 046 hardcoded the service-role JWT in the cron job's
-- Authorization header. That made it readable to anyone with SELECT on
-- cron.job (every Postgres user with the right role can list cron jobs
-- + see their command bodies). Vault stores secrets encrypted at rest
-- and exposes them only via the decrypted_secrets view, which is
-- restricted by default.
--
-- This migration:
--   1. Inserts the existing JWT into vault.secrets under name
--      'service_role_key' if not already present
--   2. Reschedules the sms-nudge-scheduler cron to read the JWT from
--      vault at execution time instead of carrying it in the command body
--
-- Operators rotating the key in the future need only update
-- vault.secrets, not redeploy this migration.
-- ============================================================

-- 1. Seed vault entry (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'service_role_key') THEN
    PERFORM vault.create_secret(
      '***SCRUBBED-SUPABASE-SERVICE-ROLE-KEY***',
      'service_role_key',
      'Supabase project service-role JWT — used by pg_cron jobs to authenticate to edge functions.'
    );
  END IF;
END
$$;

-- 2. Reschedule cron to read from vault (idempotent)
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
      'Authorization', 'Bearer ' || (
        SELECT decrypted_secret
        FROM   vault.decrypted_secrets
        WHERE  name = 'service_role_key'
        LIMIT  1
      )
    ),
    body    := '{}'::jsonb
  );
  $$
);
