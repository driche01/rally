-- 033_welcome_back_tracking.sql
-- Tracks when a "welcome back" recap was sent after a >7-day inbound silence,
-- so the recap only fires once per gap instead of every subsequent message.
-- Paired with: supabase/functions/_sms-shared/inbound-processor.ts (gap detection).

alter table trip_sessions
  add column if not exists welcome_back_sent_at timestamptz;

comment on column trip_sessions.welcome_back_sent_at is
  'Last time Rally prepended a "welcome back" recap to a participant response after >7d silence. Rate-limits the recap so it only fires once per gap.';
