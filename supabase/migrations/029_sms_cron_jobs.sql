-- SMS Agent cron jobs — nudge scheduler + outbound queue processor
--
-- Runs every 10 minutes. Handles:
--   - Poll reminders (24h/48h nudges)
--   - Momentum checks (7-day idle)
--   - Deadline reminders
--   - Pre-trip payment reminders
--   - Post-trip re-engagement
--   - Scheduled actions (hype cooldown)
--   - Outbound message queue processing

select cron.schedule(
  'sms-nudge-every-10min',
  '*/10 * * * *',
  $$
  select
    net.http_post(
      url     := 'https://qxpbnixvjtwckuedlrfj.supabase.co/functions/v1/sms-nudge-scheduler',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ***SCRUBBED-SUPABASE-SERVICE-ROLE-KEY***'
      ),
      body    := '{}'::jsonb
    );
  $$
);
