-- Remove the F2 "Planner Coach" feature.
--
-- Planner Coach was the pre-SMS-pivot AI nudging surface. It's been
-- superseded by the survey-based 1:1 SMS pivot (DecisionQueueCard,
-- CadenceCard, autonomous broadcasts). The component, hooks, edge
-- functions, and DB table are all going away.
--
-- This migration:
--   1. Unschedules the daily auto-remind pg_cron job (added in 025).
--   2. Drops the agent_settings table (added in 023). Cascade clears
--      its updated_at trigger + RLS policy + index automatically.
--
-- Edge functions (generate-nudge, auto-remind, generate-agent-message)
-- are deleted from the deployed project separately via:
--   supabase functions delete generate-nudge
--   supabase functions delete auto-remind
--   supabase functions delete generate-agent-message

-- ─── Unschedule the daily cron job ───────────────────────────────────────────
-- Wrap in a do-block because cron.unschedule throws if the job doesn't
-- exist (e.g. in a fresh local environment that never ran 025's cron).
do $$
begin
  perform cron.unschedule('auto-remind-daily');
exception when others then
  null;
end $$;

-- ─── Drop the table ──────────────────────────────────────────────────────────
drop trigger if exists agent_settings_updated_at on agent_settings;
drop function if exists update_agent_settings_updated_at();
drop table if exists agent_settings;
