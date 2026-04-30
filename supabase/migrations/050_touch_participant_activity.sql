-- ============================================================
-- Migration 050: Touch participant.last_activity_at on respondent activity
--
-- The dashboard "responded 2h ago" badge reads from
-- trip_session_participants.last_activity_at. We touch it from the
-- inbound SMS path already (inbound-processor.ts), but the survey
-- side wasn't wired — a respondent who fills the survey but never
-- texts looks "inactive" on the dashboard.
--
-- This trigger fires when a respondent's rsvp is set OR preferences
-- are written, looks up the matching trip_session_participants row by
-- (trip_id, phone), and updates last_activity_at to now(). Best-effort —
-- a missing match (web-only respondents with no phone, or trip without
-- a session yet) is silently skipped.
-- ============================================================

CREATE OR REPLACE FUNCTION respondents_touch_participant_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phone text;
BEGIN
  -- Only act when meaningful activity is recorded.
  IF NEW.rsvp IS NULL AND NEW.preferences IS NULL THEN
    RETURN NEW;
  END IF;
  -- And only when this update represents *new* activity vs. the prior state.
  IF TG_OP = 'UPDATE'
     AND NEW.rsvp IS NOT DISTINCT FROM OLD.rsvp
     AND NEW.preferences IS NOT DISTINCT FROM OLD.preferences THEN
    RETURN NEW;
  END IF;

  v_phone := normalize_phone(NEW.phone);
  IF v_phone IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE trip_session_participants p
  SET    last_activity_at = now()
  FROM   trip_sessions ts
  WHERE  p.trip_session_id = ts.id
    AND  ts.trip_id = NEW.trip_id
    AND  p.phone = v_phone;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS respondents_touch_participant_activity ON respondents;
CREATE TRIGGER respondents_touch_participant_activity
  AFTER INSERT OR UPDATE OF rsvp, preferences ON respondents
  FOR EACH ROW EXECUTE FUNCTION respondents_touch_participant_activity();
