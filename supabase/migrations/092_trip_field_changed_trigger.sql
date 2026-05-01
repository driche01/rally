-- ============================================================
-- Migration 092: trip_field_changed audit trigger (Phase 15)
--
-- Per-field audit emit when the planner edits trip details. One audit
-- row per changed field with `{ field_name, old_value, new_value }`
-- payload — so a single save touching 4 fields produces 4 events,
-- exactly as Phase 15 calls for.
--
-- Tracked columns (user-visible details only — `updated_at`,
-- `share_token`, status, etc. are not part of the planner's edit
-- surface):
--   name, destination, destination_address, start_date, end_date,
--   budget_per_person, trip_duration, group_size_bucket,
--   group_size_precise, trip_type
--
-- Actor resolution: the trigger reads `auth.uid()` from the active
-- session and maps to `users.id` via `users.auth_user_id`. For
-- service-role updates (SMS edge functions, system jobs), auth.uid()
-- is NULL and the audit row records actor_id = NULL.
--
-- Idempotent.
-- ============================================================

CREATE OR REPLACE FUNCTION emit_trip_field_changed_events()
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

  -- Helper expansion is plpgsql-verbose. Each block emits one row when
  -- the column changed (NULL-safe: NULL → 'foo' counts as a change).

  IF NEW.name IS DISTINCT FROM OLD.name THEN
    INSERT INTO trip_audit_events (trip_id, actor_id, kind, payload) VALUES (
      NEW.id, v_actor_id, 'trip_field_changed',
      jsonb_build_object('field_name', 'Trip name', 'old_value', OLD.name, 'new_value', NEW.name)
    );
  END IF;

  IF NEW.destination IS DISTINCT FROM OLD.destination THEN
    INSERT INTO trip_audit_events (trip_id, actor_id, kind, payload) VALUES (
      NEW.id, v_actor_id, 'trip_field_changed',
      jsonb_build_object('field_name', 'Destination', 'old_value', OLD.destination, 'new_value', NEW.destination)
    );
  END IF;

  IF NEW.destination_address IS DISTINCT FROM OLD.destination_address THEN
    INSERT INTO trip_audit_events (trip_id, actor_id, kind, payload) VALUES (
      NEW.id, v_actor_id, 'trip_field_changed',
      jsonb_build_object('field_name', 'Address', 'old_value', OLD.destination_address, 'new_value', NEW.destination_address)
    );
  END IF;

  IF NEW.start_date IS DISTINCT FROM OLD.start_date THEN
    INSERT INTO trip_audit_events (trip_id, actor_id, kind, payload) VALUES (
      NEW.id, v_actor_id, 'trip_field_changed',
      jsonb_build_object('field_name', 'Start date', 'old_value', to_char(OLD.start_date, 'YYYY-MM-DD'), 'new_value', to_char(NEW.start_date, 'YYYY-MM-DD'))
    );
  END IF;

  IF NEW.end_date IS DISTINCT FROM OLD.end_date THEN
    INSERT INTO trip_audit_events (trip_id, actor_id, kind, payload) VALUES (
      NEW.id, v_actor_id, 'trip_field_changed',
      jsonb_build_object('field_name', 'End date', 'old_value', to_char(OLD.end_date, 'YYYY-MM-DD'), 'new_value', to_char(NEW.end_date, 'YYYY-MM-DD'))
    );
  END IF;

  IF NEW.budget_per_person IS DISTINCT FROM OLD.budget_per_person THEN
    INSERT INTO trip_audit_events (trip_id, actor_id, kind, payload) VALUES (
      NEW.id, v_actor_id, 'trip_field_changed',
      jsonb_build_object('field_name', 'Budget', 'old_value', OLD.budget_per_person, 'new_value', NEW.budget_per_person)
    );
  END IF;

  IF NEW.trip_duration IS DISTINCT FROM OLD.trip_duration THEN
    INSERT INTO trip_audit_events (trip_id, actor_id, kind, payload) VALUES (
      NEW.id, v_actor_id, 'trip_field_changed',
      jsonb_build_object('field_name', 'Duration', 'old_value', OLD.trip_duration, 'new_value', NEW.trip_duration)
    );
  END IF;

  IF NEW.group_size_bucket IS DISTINCT FROM OLD.group_size_bucket THEN
    INSERT INTO trip_audit_events (trip_id, actor_id, kind, payload) VALUES (
      NEW.id, v_actor_id, 'trip_field_changed',
      jsonb_build_object('field_name', 'Group size', 'old_value', OLD.group_size_bucket, 'new_value', NEW.group_size_bucket)
    );
  END IF;

  IF NEW.group_size_precise IS DISTINCT FROM OLD.group_size_precise THEN
    INSERT INTO trip_audit_events (trip_id, actor_id, kind, payload) VALUES (
      NEW.id, v_actor_id, 'trip_field_changed',
      jsonb_build_object('field_name', 'Group size', 'old_value', OLD.group_size_precise, 'new_value', NEW.group_size_precise)
    );
  END IF;

  IF NEW.trip_type IS DISTINCT FROM OLD.trip_type THEN
    INSERT INTO trip_audit_events (trip_id, actor_id, kind, payload) VALUES (
      NEW.id, v_actor_id, 'trip_field_changed',
      jsonb_build_object('field_name', 'Trip type', 'old_value', OLD.trip_type, 'new_value', NEW.trip_type)
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trips_audit_field_changed ON trips;
CREATE TRIGGER trips_audit_field_changed
  AFTER UPDATE ON trips
  FOR EACH ROW EXECUTE FUNCTION emit_trip_field_changed_events();
