-- ============================================================
-- Migration 049: Reseed nudges when book-by date changes
--
-- The nudge_sends rows are scheduled relative to a trip's
-- responses_due_date. When the planner edits book-by mid-flight (e.g.
-- pushing the trip out by a week), the existing pending nudges keep
-- their stale scheduled_for timestamps and the cadence drifts away
-- from the new deadline.
--
-- Fix: a trigger on trips that, when responses_due_date changes,
-- soft-cancels every pending nudge for that trip's active session.
-- The next sms-nudge-scheduler tick (or the immediate kick from the
-- app's pokeNudgeScheduler() helper) reseeds them with the new
-- timestamps.
-- ============================================================

CREATE OR REPLACE FUNCTION trips_reseed_nudges_on_due_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_session_id uuid;
BEGIN
  -- Only act if responses_due_date actually changed.
  IF NEW.responses_due_date IS NOT DISTINCT FROM OLD.responses_due_date THEN
    RETURN NEW;
  END IF;

  -- Find the active session(s) for this trip.
  FOR v_session_id IN
    SELECT id FROM trip_sessions
    WHERE trip_id = NEW.id
      AND status IN ('ACTIVE', 'PAUSED', 'RE_ENGAGEMENT_PENDING')
  LOOP
    UPDATE nudge_sends
    SET    skipped_at  = now(),
           skip_reason = 'book_by_changed'
    WHERE  trip_session_id = v_session_id
      AND  sent_at IS NULL
      AND  skipped_at IS NULL;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trips_reseed_nudges_on_due_change ON trips;
CREATE TRIGGER trips_reseed_nudges_on_due_change
  AFTER UPDATE OF responses_due_date ON trips
  FOR EACH ROW EXECUTE FUNCTION trips_reseed_nudges_on_due_change();
