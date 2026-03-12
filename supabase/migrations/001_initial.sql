-- Enable UUID extension
create extension if not exists "pgcrypto";

-- ─── PROFILES ────────────────────────────────────────────────────────────────
create table profiles (
  id          uuid primary key references auth.users on delete cascade,
  name        text not null,
  email       text not null unique,
  created_at  timestamptz not null default now()
);

alter table profiles enable row level security;

create policy "Planners can read their own profile"
  on profiles for select using (auth.uid() = id);

create policy "Planners can update their own profile"
  on profiles for update using (auth.uid() = id);

-- Auto-create profile on signup
create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into profiles (id, name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', ''),
    new.email
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();


-- ─── TRIPS ───────────────────────────────────────────────────────────────────
create table trips (
  id                uuid primary key default gen_random_uuid(),
  created_by        uuid not null references profiles(id) on delete cascade,
  name              text not null check (char_length(name) <= 60),
  group_size_bucket text not null check (group_size_bucket in ('5-8', '9-12', '13-20', '20+')),
  travel_window     text,
  share_token       text not null unique default encode(gen_random_bytes(12), 'hex'),
  status            text not null default 'active' check (status in ('active', 'closed')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

alter table trips enable row level security;

create policy "Planners can manage their own trips"
  on trips for all using (auth.uid() = created_by);

-- Allow unauthenticated reads via share_token (for web respondent experience)
create policy "Anyone can read a trip by share_token"
  on trips for select using (true);

create index trips_created_by_idx on trips(created_by);
create index trips_share_token_idx on trips(share_token);

-- Auto-update updated_at
create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trips_updated_at
  before update on trips
  for each row execute procedure update_updated_at();


-- ─── POLLS ───────────────────────────────────────────────────────────────────
create table polls (
  id                  uuid primary key default gen_random_uuid(),
  trip_id             uuid not null references trips(id) on delete cascade,
  type                text not null check (type in ('destination', 'dates', 'budget')),
  title               text not null,
  allow_multi_select  boolean not null default false,
  status              text not null default 'draft' check (status in ('draft', 'live', 'closed', 'decided')),
  decided_option_id   uuid,
  position            integer not null default 0,
  created_at          timestamptz not null default now()
);

alter table polls enable row level security;

create policy "Planners can manage polls for their trips"
  on polls for all using (
    exists (select 1 from trips where trips.id = polls.trip_id and trips.created_by = auth.uid())
  );

create policy "Anyone can read live/closed/decided polls"
  on polls for select using (status in ('live', 'closed', 'decided'));

create index polls_trip_id_idx on polls(trip_id);


-- ─── POLL OPTIONS ────────────────────────────────────────────────────────────
create table poll_options (
  id          uuid primary key default gen_random_uuid(),
  poll_id     uuid not null references polls(id) on delete cascade,
  label       text not null check (char_length(label) <= 40),
  position    integer not null default 0,
  created_at  timestamptz not null default now()
);

alter table poll_options enable row level security;

create policy "Planners can manage options for their polls"
  on poll_options for all using (
    exists (
      select 1 from polls
      join trips on trips.id = polls.trip_id
      where polls.id = poll_options.poll_id
        and trips.created_by = auth.uid()
    )
  );

create policy "Anyone can read poll options"
  on poll_options for select using (true);

create index poll_options_poll_id_idx on poll_options(poll_id);

-- Add FK for decided_option_id after poll_options table exists
alter table polls
  add constraint polls_decided_option_id_fkey
  foreign key (decided_option_id) references poll_options(id) on delete set null;


-- ─── RESPONDENTS ─────────────────────────────────────────────────────────────
-- Group members who respond via the share link. No auth required.
-- session_token stored in browser localStorage for re-identification.
create table respondents (
  id             uuid primary key default gen_random_uuid(),
  trip_id        uuid not null references trips(id) on delete cascade,
  name           text not null check (char_length(name) <= 30),
  session_token  text not null,
  created_at     timestamptz not null default now(),
  unique (trip_id, session_token)
);

alter table respondents enable row level security;

create policy "Planners can read respondents for their trips"
  on respondents for select using (
    exists (select 1 from trips where trips.id = respondents.trip_id and trips.created_by = auth.uid())
  );

create policy "Anyone can insert a respondent"
  on respondents for insert with check (true);

create policy "Session owner can update their respondent row"
  on respondents for update using (true);

create index respondents_trip_id_idx on respondents(trip_id);
create index respondents_session_token_idx on respondents(session_token);


-- ─── POLL RESPONSES ──────────────────────────────────────────────────────────
create table poll_responses (
  id             uuid primary key default gen_random_uuid(),
  poll_id        uuid not null references polls(id) on delete cascade,
  respondent_id  uuid not null references respondents(id) on delete cascade,
  option_id      uuid not null references poll_options(id) on delete cascade,
  created_at     timestamptz not null default now(),
  unique (poll_id, respondent_id, option_id)
);

alter table poll_responses enable row level security;

create policy "Planners can read responses for their trips"
  on poll_responses for select using (
    exists (
      select 1 from polls
      join trips on trips.id = polls.trip_id
      where polls.id = poll_responses.poll_id
        and trips.created_by = auth.uid()
    )
  );

create policy "Anyone can insert a response"
  on poll_responses for insert with check (true);

create policy "Anyone can delete their own response"
  on poll_responses for delete using (true);

create index poll_responses_poll_id_idx on poll_responses(poll_id);
create index poll_responses_respondent_id_idx on poll_responses(respondent_id);


-- ─── ANALYTICS EVENTS ────────────────────────────────────────────────────────
create table analytics_events (
  id          uuid primary key default gen_random_uuid(),
  event_type  text not null,
  trip_id     uuid references trips(id) on delete set null,
  metadata    jsonb,
  created_at  timestamptz not null default now()
);

alter table analytics_events enable row level security;

create policy "Anyone can insert analytics events"
  on analytics_events for insert with check (true);

create policy "Planners can read their own analytics"
  on analytics_events for select using (
    trip_id is null or
    exists (select 1 from trips where trips.id = analytics_events.trip_id and trips.created_by = auth.uid())
  );
