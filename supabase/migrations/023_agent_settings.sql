-- Phase 5 F2: Planner AI Coach — agent settings and nudge log
--
-- agent_settings: per-trip opt-in for autonomous nudges (auto_remind toggle)
-- agent_nudge_log: tracks which nudge scenarios have been generated/sent,
--   to prevent duplicate nudges and support the "ready to send" queue

create table if not exists agent_settings (
  id            uuid primary key default gen_random_uuid(),
  trip_id       uuid not null references trips(id) on delete cascade,
  auto_remind   boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (trip_id)
);

create table if not exists agent_nudge_log (
  id            uuid primary key default gen_random_uuid(),
  trip_id       uuid not null references trips(id) on delete cascade,
  scenario      text not null,           -- 'poll_reminder' | 'plan_share' | 'confirmed_group_summary'
  message_text  text not null,           -- the generated message (ready for planner to send)
  sent_at       timestamptz,             -- null = not yet sent, set by client on user send
  created_at    timestamptz not null default now()
);

-- Indexes
create index if not exists agent_settings_trip_id_idx on agent_settings(trip_id);
create index if not exists agent_nudge_log_trip_id_idx on agent_nudge_log(trip_id);
create index if not exists agent_nudge_log_trip_scenario_idx on agent_nudge_log(trip_id, scenario, created_at desc);

-- RLS
alter table agent_settings enable row level security;
alter table agent_nudge_log enable row level security;

-- Planner can read/write their own trip's settings
create policy "planner can manage agent_settings"
  on agent_settings for all
  using (
    exists (
      select 1 from trips
      where trips.id = agent_settings.trip_id
        and trips.created_by = auth.uid()
    )
  );

-- Planner can read/write nudge log for their trips
create policy "planner can manage agent_nudge_log"
  on agent_nudge_log for all
  using (
    exists (
      select 1 from trips
      where trips.id = agent_nudge_log.trip_id
        and trips.created_by = auth.uid()
    )
  );

-- Auto-update updated_at on agent_settings
create or replace function update_agent_settings_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger agent_settings_updated_at
  before update on agent_settings
  for each row execute function update_agent_settings_updated_at();
