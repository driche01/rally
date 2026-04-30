-- Enable strict RLS on all tables flagged by Supabase advisor.
--
-- All of these tables are accessed exclusively via the service role
-- (either from edge functions or server-side scripts). Enabling RLS
-- with no policies means anon/authenticated keys get zero rows, while
-- the service role bypasses RLS entirely.
--
-- The 4 tables previously read from app/trip/[id].tsx via the anon
-- key (trip_access_tokens, trip_sessions, trip_session_participants,
-- split_requests) are now routed through the `trip-view` edge function,
-- which uses the service role. See supabase/functions/trip-view/.

alter table booking_signals                enable row level security;
alter table outbound_message_queue         enable row level security;
alter table propose_requests               enable row level security;
alter table scheduled_actions              enable row level security;
alter table split_requests                 enable row level security;
alter table thread_messages                enable row level security;
alter table trip_access_tokens             enable row level security;
alter table trip_session_events            enable row level security;
alter table trip_session_participants      enable row level security;
alter table trip_sessions                  enable row level security;
alter table user_preferences               enable row level security;
alter table users                          enable row level security;
