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
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF4cGJuaXh2anR3Y2t1ZWRscmZqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzIwMDI0MywiZXhwIjoyMDg4Nzc2MjQzfQ.ZBkGoUbavzMkiHcN_FQt38GbbMCx2PKbYyZd2hau_28'
      ),
      body    := '{}'::jsonb
    );
  $$
);
