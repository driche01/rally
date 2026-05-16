-- ============================================================
-- Migration 123: Phase A — mutuals graph trigger
--
-- Per BUILD_QUESTIONS Q1 + Q3 + scope §6 Step 10: populate the
-- mutuals table when a respondent confirms (rsvp_status = 'going')
-- by upserting symmetric rows between this user and every other
-- 'going' respondent on the same trip.
--
-- Constraints
--   - mutuals.user_id + mutual_user_id both FK users(id), so we
--     only link respondents that have a users.id. Phone-only
--     invitees without an account are skipped — they get added
--     to the graph when they sign up + RSVP somewhere later.
--   - Per shared trip, we increment shared_trip_count by 1 in
--     each direction. last_traveled_together_at = now().
--
-- Phase A note: trips don't "complete" yet — the build guide
-- explicitly says "after RSVP" stands in for "after the trip."
-- When the trip lifecycle layer lands in Phase B/C, we can move
-- this to a "trip completed" event.
-- ============================================================

CREATE OR REPLACE FUNCTION phase_a_emit_mutuals_for_respondent()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  this_user uuid := NEW.user_id;
  peer record;
BEGIN
  IF this_user IS NULL OR NEW.rsvp_status IS DISTINCT FROM 'going' THEN
    RETURN NEW;
  END IF;

  -- On UPDATE: only fire when status transitioned INTO 'going'
  -- (avoids retriggering on, say, a name edit while already going).
  IF TG_OP = 'UPDATE'
     AND OLD.rsvp_status IS NOT DISTINCT FROM NEW.rsvp_status THEN
    RETURN NEW;
  END IF;

  FOR peer IN
    SELECT DISTINCT user_id
    FROM respondents
    WHERE trip_id = NEW.trip_id
      AND user_id IS NOT NULL
      AND user_id <> this_user
      AND rsvp_status = 'going'
  LOOP
    -- (this_user → peer)
    INSERT INTO mutuals (user_id, mutual_user_id, shared_trip_count, last_traveled_together_at, created_at, updated_at)
      VALUES (this_user, peer.user_id, 1, now(), now(), now())
      ON CONFLICT (user_id, mutual_user_id) DO UPDATE
        SET shared_trip_count          = mutuals.shared_trip_count + 1,
            last_traveled_together_at  = now(),
            updated_at                 = now();

    -- (peer → this_user)
    INSERT INTO mutuals (user_id, mutual_user_id, shared_trip_count, last_traveled_together_at, created_at, updated_at)
      VALUES (peer.user_id, this_user, 1, now(), now(), now())
      ON CONFLICT (user_id, mutual_user_id) DO UPDATE
        SET shared_trip_count          = mutuals.shared_trip_count + 1,
            last_traveled_together_at  = now(),
            updated_at                 = now();
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_phase_a_mutuals_on_respondent_change ON respondents;
CREATE TRIGGER trg_phase_a_mutuals_on_respondent_change
  AFTER INSERT OR UPDATE OF rsvp_status, user_id ON respondents
  FOR EACH ROW
  EXECUTE FUNCTION phase_a_emit_mutuals_for_respondent();

INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES ('123', 'phase_a_mutuals_trigger', ARRAY[]::text[])
ON CONFLICT (version) DO NOTHING;
