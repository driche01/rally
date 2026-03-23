-- Phase 5 F2: Auto-remind — adds last_notified_at to agent_settings and
-- schedules the auto-remind edge function via pg_cron.
--
-- The edge function fires once daily (9 AM UTC) for every trip where the
-- planner has toggled auto_remind ON, runs nudge scoring, and sends an
-- Expo push notification if there are actionable items.

-- Track when we last pushed a notification for this trip so we don't spam.
alter table agent_settings
  add column if not exists last_notified_at timestamptz;

-- ─── pg_cron + pg_net ────────────────────────────────────────────────────────
-- These extensions must be enabled in the Supabase dashboard under
-- Database → Extensions before applying this migration.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net  with schema extensions;

-- ─── Daily auto-remind cron job ──────────────────────────────────────────────
-- Runs at 9:00 AM UTC every day.
--
-- BEFORE APPLYING: replace the two placeholders below with your project's
-- actual values from Supabase Dashboard → Settings → API:
--   <PROJECT_REF>      e.g. abcdefghijklmnop
--   <eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF4cGJuaXh2anR3Y2t1ZWRscmZqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzIwMDI0MywiZXhwIjoyMDg4Nzc2MjQzfQ.ZBkGoUbavzMkiHcN_FQt38GbbMCx2PKbYyZd2hau_28> the service_role JWT (keep this secret)

select cron.schedule(
  'auto-remind-daily',
  '0 9 * * *',
  $$
  select
    net.http_post(
      url     := 'https://qxpbnixvjtwckuedlrfj.supabase.co/functions/v1/auto-remind',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
      ),
      body    := '{}'::jsonb
    );
  $$
);
