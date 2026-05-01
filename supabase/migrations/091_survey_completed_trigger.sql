-- ============================================================
-- Migration 091: survey_completed audit trigger (Phase 15)
--
-- "Member finished the survey" = a respondents row transitions from
-- incomplete (missing RSVP or preferences) to complete (both set) for
-- the first time. Emits exactly one `survey_completed` audit event per
-- respondent per trip.
--
-- This is derived from data — no planner-intent context needed — so it
-- lives as a DB trigger alongside the other auto-emit lifecycle events
-- in migration 090. Kept in its own migration because it's emit-only,
-- not part of the original trigger batch.
--
-- Idempotent.
-- ============================================================

CREATE OR REPLACE FUNCTION emit_survey_completed_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id   uuid;
  v_was_done   boolean;
  v_now_done   boolean;
BEGIN
  -- Only fire on the transition from "incomplete" → "complete". Skip
  -- subsequent updates after the row is already complete.
  v_was_done := OLD.rsvp IS NOT NULL AND OLD.preferences IS NOT NULL;
  v_now_done := NEW.rsvp IS NOT NULL AND NEW.preferences IS NOT NULL;

  IF v_was_done OR NOT v_now_done THEN
    RETURN NEW;
  END IF;

  -- Best-effort actor resolution: respondents may not be linked to a
  -- users row (web-only respondents have no SMS handshake yet). When
  -- there's no users-id match by phone, leave actor_id NULL — the
  -- event row still records the respondent_id + display name.
  IF NEW.phone IS NOT NULL THEN
    SELECT id INTO v_actor_id FROM users WHERE phone = NEW.phone LIMIT 1;
  END IF;

  INSERT INTO trip_audit_events (trip_id, actor_id, kind, payload)
  VALUES (
    NEW.trip_id,
    v_actor_id,
    'survey_completed',
    jsonb_build_object(
      'respondent_id', NEW.id,
      'display_name',  NEW.name,
      'phone',         NEW.phone
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS respondents_audit_survey_completed ON respondents;
CREATE TRIGGER respondents_audit_survey_completed
  AFTER UPDATE ON respondents
  FOR EACH ROW EXECUTE FUNCTION emit_survey_completed_event();
