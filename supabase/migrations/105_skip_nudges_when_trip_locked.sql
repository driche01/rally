-- ============================================================
-- Migration 105: Skip pending nudges when a trip is fully locked
--
-- Background: nudge_sends rows are seeded per (session, participant,
-- kind) and pulled by the dashboard CadenceCard while sent_at and
-- skipped_at are both NULL. When all polls on a trip reach status =
-- 'decided', the trip is "ready to book" — there is nothing left
-- for members to weigh in on, so the entire pending nudge schedule
-- becomes noise. Without an explicit gate, those rows would still:
--   * appear on the trip dashboard ("4 upcoming" next to "Decisions
--     are locked"), confusing the planner;
--   * fire from the scheduler at their scheduled times until each
--     row's individual `already_responded` skip kicks in.
--
-- This migration installs a pair of triggers on `polls` that
-- maintain `nudge_sends` consistency with trip-lock state:
--
--   1. polls_skip_nudges_on_lock — fires on the transition INTO
--      status='decided'. If no other polls on the trip are still
--      undecided, marks every pending nudge_sends row for the
--      trip's session as skipped with reason='trip_locked'.
--
--   2. polls_restore_nudges_on_unlock — fires on the transition
--      OUT OF status='decided' (the 5-minute "JUST LOCKED · UNDO"
--      affordance and any deliberate unlock). Reverses the skip
--      for rows that were skipped with reason='trip_locked' AND
--      whose scheduled_for is still in the future. Past-due rows
--      are left skipped — resurrecting them would just fire stale
--      nudges hours/days late.
--
-- The unique partial index on (session, participant, kind) WHERE
-- sent_at IS NULL AND skipped_at IS NULL means we don't get
-- conflicts from the unskip path: while a row is skipped, the
-- scheduler's seedSession existence check (which scans all rows
-- regardless of state) prevents creating a duplicate pending row,
-- so flipping skipped_at back to NULL is always safe.
--
-- Idempotent.
-- ============================================================


-- ─── 1. Lock → skip pending nudges ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION skip_nudges_when_trip_locked()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_undecided_count int;
BEGIN
  IF NEW.status <> 'decided' OR OLD.status = 'decided' THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*) INTO v_undecided_count
  FROM   polls
  WHERE  trip_id = NEW.trip_id
    AND  id <> NEW.id
    AND  status <> 'decided';

  IF v_undecided_count > 0 THEN
    RETURN NEW;
  END IF;

  UPDATE nudge_sends ns
  SET    skipped_at  = now(),
         skip_reason = 'trip_locked'
  FROM   trip_sessions ts
  WHERE  ts.trip_id = NEW.trip_id
    AND  ns.trip_session_id = ts.id
    AND  ns.sent_at    IS NULL
    AND  ns.skipped_at IS NULL;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS polls_skip_nudges_on_lock ON polls;
CREATE TRIGGER polls_skip_nudges_on_lock
  AFTER UPDATE OF status ON polls
  FOR EACH ROW EXECUTE FUNCTION skip_nudges_when_trip_locked();


-- ─── 2. Unlock → restore pending nudges ─────────────────────────────────────

CREATE OR REPLACE FUNCTION restore_nudges_when_trip_unlocked()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status <> 'decided' OR NEW.status = 'decided' THEN
    RETURN NEW;
  END IF;

  UPDATE nudge_sends ns
  SET    skipped_at  = NULL,
         skip_reason = NULL
  FROM   trip_sessions ts
  WHERE  ts.trip_id = NEW.trip_id
    AND  ns.trip_session_id = ts.id
    AND  ns.sent_at      IS NULL
    AND  ns.skipped_at   IS NOT NULL
    AND  ns.skip_reason  = 'trip_locked'
    AND  ns.scheduled_for > now();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS polls_restore_nudges_on_unlock ON polls;
CREATE TRIGGER polls_restore_nudges_on_unlock
  AFTER UPDATE OF status ON polls
  FOR EACH ROW EXECUTE FUNCTION restore_nudges_when_trip_unlocked();
