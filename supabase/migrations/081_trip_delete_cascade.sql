-- 081_trip_delete_cascade.sql
-- Make trip deletion actually work.
--
-- Migration 026 declared trip_sessions and several dependent tables with FK
-- columns missing an ON DELETE clause (so Postgres defaulted to NO ACTION).
-- The first one (trip_sessions.trip_id) blocks `DELETE FROM trips ...`
-- outright; the rest would block the cascade chain even if the first didn't.
--
-- Not every dependent table from 026 actually exists on every environment
-- (some were never created on remote, or were dropped elsewhere), so each
-- ALTER is gated on table existence via to_regclass().

-- 1. trip_sessions.trip_id -> trips(id) CASCADE  [the root cause]
DO $$ BEGIN
  IF to_regclass('public.trip_sessions') IS NOT NULL THEN
    ALTER TABLE trip_sessions DROP CONSTRAINT IF EXISTS trip_sessions_trip_id_fkey;
    ALTER TABLE trip_sessions
      ADD CONSTRAINT trip_sessions_trip_id_fkey
      FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE;

    ALTER TABLE trip_sessions DROP CONSTRAINT IF EXISTS trip_sessions_parent_session_id_fkey;
    ALTER TABLE trip_sessions
      ADD CONSTRAINT trip_sessions_parent_session_id_fkey
      FOREIGN KEY (parent_session_id) REFERENCES trip_sessions(id) ON DELETE SET NULL;

    ALTER TABLE trip_sessions DROP CONSTRAINT IF EXISTS trip_sessions_child_session_id_fkey;
    ALTER TABLE trip_sessions
      ADD CONSTRAINT trip_sessions_child_session_id_fkey
      FOREIGN KEY (child_session_id) REFERENCES trip_sessions(id) ON DELETE SET NULL;

    -- polls cascade-delete via polls.trip_id (CASCADE since 001), so during a
    -- trip delete this FK gets nulled while the trip_session row is itself
    -- being deleted in the same statement.
    ALTER TABLE trip_sessions DROP CONSTRAINT IF EXISTS trip_sessions_current_poll_id_fkey;
    ALTER TABLE trip_sessions
      ADD CONSTRAINT trip_sessions_current_poll_id_fkey
      FOREIGN KEY (current_poll_id) REFERENCES polls(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 2. polls.trip_session_id -> trip_sessions(id) SET NULL
--    polls already cascade via polls.trip_id; SET NULL avoids any ordering edge case.
DO $$ BEGIN
  IF to_regclass('public.polls') IS NOT NULL
     AND to_regclass('public.trip_sessions') IS NOT NULL THEN
    ALTER TABLE polls DROP CONSTRAINT IF EXISTS polls_trip_session_id_fkey;
    ALTER TABLE polls
      ADD CONSTRAINT polls_trip_session_id_fkey
      FOREIGN KEY (trip_session_id) REFERENCES trip_sessions(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 3. Dependent tables that chain off trip_sessions -> CASCADE.
--    Each gated on existence; trip_session_participants already has CASCADE
--    in 026 but we re-assert it for symmetry on environments where it may differ.
DO $$ BEGIN
  IF to_regclass('public.trip_session_events') IS NOT NULL THEN
    ALTER TABLE trip_session_events DROP CONSTRAINT IF EXISTS trip_session_events_trip_session_id_fkey;
    ALTER TABLE trip_session_events
      ADD CONSTRAINT trip_session_events_trip_session_id_fkey
      FOREIGN KEY (trip_session_id) REFERENCES trip_sessions(id) ON DELETE CASCADE;
  END IF;

  IF to_regclass('public.thread_messages') IS NOT NULL THEN
    ALTER TABLE thread_messages DROP CONSTRAINT IF EXISTS thread_messages_trip_session_id_fkey;
    ALTER TABLE thread_messages
      ADD CONSTRAINT thread_messages_trip_session_id_fkey
      FOREIGN KEY (trip_session_id) REFERENCES trip_sessions(id) ON DELETE CASCADE;
  END IF;

  IF to_regclass('public.scheduled_actions') IS NOT NULL THEN
    ALTER TABLE scheduled_actions DROP CONSTRAINT IF EXISTS scheduled_actions_trip_session_id_fkey;
    ALTER TABLE scheduled_actions
      ADD CONSTRAINT scheduled_actions_trip_session_id_fkey
      FOREIGN KEY (trip_session_id) REFERENCES trip_sessions(id) ON DELETE CASCADE;
  END IF;

  IF to_regclass('public.outbound_message_queue') IS NOT NULL THEN
    ALTER TABLE outbound_message_queue DROP CONSTRAINT IF EXISTS outbound_message_queue_trip_session_id_fkey;
    ALTER TABLE outbound_message_queue
      ADD CONSTRAINT outbound_message_queue_trip_session_id_fkey
      FOREIGN KEY (trip_session_id) REFERENCES trip_sessions(id) ON DELETE CASCADE;
  END IF;

  IF to_regclass('public.trip_access_tokens') IS NOT NULL THEN
    ALTER TABLE trip_access_tokens DROP CONSTRAINT IF EXISTS trip_access_tokens_trip_session_id_fkey;
    ALTER TABLE trip_access_tokens
      ADD CONSTRAINT trip_access_tokens_trip_session_id_fkey
      FOREIGN KEY (trip_session_id) REFERENCES trip_sessions(id) ON DELETE CASCADE;
  END IF;

  IF to_regclass('public.split_requests') IS NOT NULL THEN
    ALTER TABLE split_requests DROP CONSTRAINT IF EXISTS split_requests_trip_session_id_fkey;
    ALTER TABLE split_requests
      ADD CONSTRAINT split_requests_trip_session_id_fkey
      FOREIGN KEY (trip_session_id) REFERENCES trip_sessions(id) ON DELETE CASCADE;
  END IF;

  IF to_regclass('public.propose_requests') IS NOT NULL THEN
    ALTER TABLE propose_requests DROP CONSTRAINT IF EXISTS propose_requests_trip_session_id_fkey;
    ALTER TABLE propose_requests
      ADD CONSTRAINT propose_requests_trip_session_id_fkey
      FOREIGN KEY (trip_session_id) REFERENCES trip_sessions(id) ON DELETE CASCADE;
  END IF;

  IF to_regclass('public.booking_signals') IS NOT NULL THEN
    ALTER TABLE booking_signals DROP CONSTRAINT IF EXISTS booking_signals_trip_session_id_fkey;
    ALTER TABLE booking_signals
      ADD CONSTRAINT booking_signals_trip_session_id_fkey
      FOREIGN KEY (trip_session_id) REFERENCES trip_sessions(id) ON DELETE CASCADE;
  END IF;
END $$;
