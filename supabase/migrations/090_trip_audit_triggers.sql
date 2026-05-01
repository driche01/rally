-- ============================================================
-- Migration 090: Trip audit-event triggers (Phase 15)
--
-- Auto-emit events for the lifecycle moments where DB state alone is
-- enough signal — no planner-intent context needed:
--   - trip_created                  AFTER INSERT  ON trips
--   - member_joined                 AFTER INSERT  ON trip_session_participants
--   - member_opted_out              AFTER UPDATE  ON trip_session_participants
--   - traveler_profile_updated      AFTER INSERT/UPDATE ON traveler_profiles
--                                   (fan-out per active trip — profiles are
--                                   keyed by phone, so one edit ripples)
--
-- Events that need planner intent (member_added_by_planner,
-- member_removed_by_planner, trip_field_changed, poll lifecycle,
-- survey_completed) emit from app code in a later phase.
--
-- Idempotent: CREATE OR REPLACE on functions; drop-then-create on
-- triggers so re-applying picks up function-signature changes.
-- ============================================================


-- ─── 1. trip_created ────────────────────────────────────────────────────────
-- Resolves trips.created_by (profiles.id == auth.users.id) → users.id via
-- users.auth_user_id. Falls back to NULL actor_id when no users row
-- exists yet (test fixtures, edge cases — payload still records the trip).

CREATE OR REPLACE FUNCTION emit_trip_created_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid;
BEGIN
  SELECT id INTO v_actor_id
  FROM users
  WHERE auth_user_id = NEW.created_by
  LIMIT 1;

  INSERT INTO trip_audit_events (trip_id, actor_id, kind, payload)
  VALUES (
    NEW.id,
    v_actor_id,
    'trip_created',
    jsonb_build_object('name', NEW.name)
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trips_audit_created ON trips;
CREATE TRIGGER trips_audit_created
  AFTER INSERT ON trips
  FOR EACH ROW EXECUTE FUNCTION emit_trip_created_event();


-- ─── 2. member_joined ───────────────────────────────────────────────────────
-- Fires when a participant row is first inserted into a session. The
-- participant *is* the actor — they joined themselves (via SMS or web
-- handshake). For planner-driven adds, the planner's identity is
-- captured separately in the upcoming `member_added_by_planner` app
-- emit; this event is the "who actually joined the thread" record.

CREATE OR REPLACE FUNCTION emit_member_joined_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_trip_id uuid;
BEGIN
  SELECT trip_id INTO v_trip_id
  FROM trip_sessions
  WHERE id = NEW.trip_session_id
  LIMIT 1;

  IF v_trip_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO trip_audit_events (trip_id, actor_id, kind, payload)
  VALUES (
    v_trip_id,
    NEW.user_id,
    'member_joined',
    jsonb_build_object(
      'participant_id', NEW.id,
      'display_name',   NEW.display_name,
      'phone',          NEW.phone
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trip_session_participants_audit_joined ON trip_session_participants;
CREATE TRIGGER trip_session_participants_audit_joined
  AFTER INSERT ON trip_session_participants
  FOR EACH ROW EXECUTE FUNCTION emit_member_joined_event();


-- ─── 3. member_opted_out ────────────────────────────────────────────────────
-- Fires when a participant's status flips to 'opted_out'. The actor IS
-- the participant (they texted STOP or otherwise opted out).
-- Status flips to 'removed_by_planner' are handled by the upcoming
-- `member_removed_by_planner` app emit (planner identity matters there).

CREATE OR REPLACE FUNCTION emit_member_opted_out_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_trip_id uuid;
BEGIN
  -- Only fire on the transition into 'opted_out'.
  IF NEW.status <> 'opted_out' OR OLD.status = 'opted_out' THEN
    RETURN NEW;
  END IF;

  SELECT trip_id INTO v_trip_id
  FROM trip_sessions
  WHERE id = NEW.trip_session_id
  LIMIT 1;

  IF v_trip_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO trip_audit_events (trip_id, actor_id, kind, payload)
  VALUES (
    v_trip_id,
    NEW.user_id,
    'member_opted_out',
    jsonb_build_object(
      'participant_id', NEW.id,
      'display_name',   NEW.display_name,
      'phone',          NEW.phone
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trip_session_participants_audit_opted_out ON trip_session_participants;
CREATE TRIGGER trip_session_participants_audit_opted_out
  AFTER UPDATE OF status ON trip_session_participants
  FOR EACH ROW EXECUTE FUNCTION emit_member_opted_out_event();


-- ─── 4. traveler_profile_updated ────────────────────────────────────────────
-- Profiles are PRIMARY KEY (phone) — global per user, not per trip.
-- A single profile edit ripples to every active trip the user is in,
-- so we fan-out one audit row per matching session.
--
-- Fires on INSERT (first profile save) and UPDATE (any subsequent edit).
-- Both feel the same to the planner: "Sarah updated her travel preferences."

CREATE OR REPLACE FUNCTION emit_traveler_profile_updated_events()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_match RECORD;
BEGIN
  FOR v_match IN
    SELECT
      ts.trip_id,
      p.id           AS participant_id,
      p.display_name,
      p.user_id,
      p.phone
    FROM trip_session_participants p
    JOIN trip_sessions ts ON ts.id = p.trip_session_id
    WHERE p.phone = NEW.phone
      AND p.status = 'active'
      AND ts.status IN ('ACTIVE', 'PAUSED', 'RE_ENGAGEMENT_PENDING')
  LOOP
    INSERT INTO trip_audit_events (trip_id, actor_id, kind, payload)
    VALUES (
      v_match.trip_id,
      v_match.user_id,
      'traveler_profile_updated',
      jsonb_build_object(
        'participant_id', v_match.participant_id,
        'display_name',   v_match.display_name,
        'phone',          v_match.phone
      )
    );
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS traveler_profiles_audit_updated ON traveler_profiles;
CREATE TRIGGER traveler_profiles_audit_updated
  AFTER INSERT OR UPDATE ON traveler_profiles
  FOR EACH ROW EXECUTE FUNCTION emit_traveler_profile_updated_events();
