-- ============================================================
-- Migration 093: Poll lifecycle audit triggers (Phase 15)
--
-- Auto-emit `poll_added`, `poll_removed`, `poll_decided` to the
-- activity feed. Same pattern as 090–092: SECURITY DEFINER trigger
-- functions resolving actor via auth.uid() → users.auth_user_id →
-- users.id, NULL when running under service role.
--
-- `poll_decided` resolves the chosen option's label at emit time so
-- the activity UI doesn't need to back-reference poll_options (which
-- can be deleted independently). For free-form numeric polls (the
-- duration poll has no preset options), the label stays NULL and the
-- UI falls back on the poll title alone.
--
-- Idempotent.
-- ============================================================


-- ─── Shared actor resolution ────────────────────────────────────────────────
-- Inlined into each function to keep this migration self-contained;
-- if this pattern shows up a third time we should extract a helper.


-- ─── 1. poll_added ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION emit_poll_added_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid;
  v_uid      uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NOT NULL THEN
    SELECT id INTO v_actor_id FROM users WHERE auth_user_id = v_uid LIMIT 1;
  END IF;

  INSERT INTO trip_audit_events (trip_id, actor_id, kind, payload)
  VALUES (
    NEW.trip_id,
    v_actor_id,
    'poll_added',
    jsonb_build_object(
      'poll_id', NEW.id,
      'title',   NEW.title,
      'type',    NEW.type
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS polls_audit_added ON polls;
CREATE TRIGGER polls_audit_added
  AFTER INSERT ON polls
  FOR EACH ROW EXECUTE FUNCTION emit_poll_added_event();


-- ─── 2. poll_removed ────────────────────────────────────────────────────────
-- BEFORE DELETE so OLD is still readable. The trip_id might already be
-- gone if the parent trip is being CASCADE-deleted; in that case the
-- audit insert would dangle — guard with an EXISTS check so trip
-- deletion stays clean.

CREATE OR REPLACE FUNCTION emit_poll_removed_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id  uuid;
  v_uid       uuid;
  v_trip_alive boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM trips WHERE id = OLD.trip_id) INTO v_trip_alive;
  IF NOT v_trip_alive THEN
    RETURN OLD;
  END IF;

  v_uid := auth.uid();
  IF v_uid IS NOT NULL THEN
    SELECT id INTO v_actor_id FROM users WHERE auth_user_id = v_uid LIMIT 1;
  END IF;

  INSERT INTO trip_audit_events (trip_id, actor_id, kind, payload)
  VALUES (
    OLD.trip_id,
    v_actor_id,
    'poll_removed',
    jsonb_build_object(
      'poll_id', OLD.id,
      'title',   OLD.title,
      'type',    OLD.type
    )
  );

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS polls_audit_removed ON polls;
CREATE TRIGGER polls_audit_removed
  BEFORE DELETE ON polls
  FOR EACH ROW EXECUTE FUNCTION emit_poll_removed_event();


-- ─── 3. poll_decided ────────────────────────────────────────────────────────
-- Fires only on the transition into status = 'decided'. Subsequent
-- updates to a decided poll (e.g. position reorder) don't re-emit.

CREATE OR REPLACE FUNCTION emit_poll_decided_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid;
  v_uid      uuid;
  v_label    text;
BEGIN
  IF NEW.status <> 'decided' OR OLD.status = 'decided' THEN
    RETURN NEW;
  END IF;

  v_uid := auth.uid();
  IF v_uid IS NOT NULL THEN
    SELECT id INTO v_actor_id FROM users WHERE auth_user_id = v_uid LIMIT 1;
  END IF;

  IF NEW.decided_option_id IS NOT NULL THEN
    SELECT label INTO v_label FROM poll_options WHERE id = NEW.decided_option_id LIMIT 1;
  END IF;

  INSERT INTO trip_audit_events (trip_id, actor_id, kind, payload)
  VALUES (
    NEW.trip_id,
    v_actor_id,
    'poll_decided',
    jsonb_build_object(
      'poll_id',           NEW.id,
      'title',             NEW.title,
      'type',              NEW.type,
      'decided_option_id', NEW.decided_option_id,
      'decided_value',     v_label
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS polls_audit_decided ON polls;
CREATE TRIGGER polls_audit_decided
  AFTER UPDATE OF status, decided_option_id ON polls
  FOR EACH ROW EXECUTE FUNCTION emit_poll_decided_event();
