-- ============================================================
-- Migration 103: Server-side cache for travel suggestions
--
-- Why: when a user opens the Travel tab, group suggestions
-- should render instantly — no spinner, no Gemini round-trip.
-- We cache the suggestion payload on the trip row, gated by a
-- signature of the inputs that produced it. When inputs change
-- the signature flips; the next read computes fresh and writes
-- the new entry back.
--
-- Mirrors the lodging cache (migration 102) — same trigger
-- shape, same pg_net warm-on-edit pattern. The trigger fires
-- `suggest-travel` via pg_net the moment trip details first
-- lock in (destination + start_date) so the cache is warm
-- before the user ever taps Travel.
--
-- Per-member suggestions (scoped to a single traveler's home
-- airport) stay on the on-demand edge-function path — the
-- planner taps to fire each row, so latency is expected and
-- caching adds little. Only the auto-firing group card
-- benefits from this cache.
-- ============================================================

ALTER TABLE trips
  ADD COLUMN IF NOT EXISTS cached_travel_suggestions          jsonb,
  ADD COLUMN IF NOT EXISTS cached_travel_suggestions_signature text,
  ADD COLUMN IF NOT EXISTS cached_travel_suggestions_updated_at timestamptz;

COMMENT ON COLUMN trips.cached_travel_suggestions IS
  'Cached TravelSuggestion[] payload for the group scope. Populated by suggest-travel; read directly by the client for instant render.';
COMMENT ON COLUMN trips.cached_travel_suggestions_signature IS
  'Signature of the inputs used to compute the cached payload. Cache is valid when this matches the current input signature.';

-- ─── Trigger: warm the travel cache on details change ───────────────────────

CREATE OR REPLACE FUNCTION trip_warm_travel_cache()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inputs_changed boolean := false;
  v_service_key    text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_inputs_changed := true;
  ELSE
    v_inputs_changed :=
      NEW.destination           IS DISTINCT FROM OLD.destination
      OR NEW.start_date         IS DISTINCT FROM OLD.start_date
      OR NEW.end_date           IS DISTINCT FROM OLD.end_date
      OR NEW.group_size_precise IS DISTINCT FROM OLD.group_size_precise
      OR NEW.group_size_bucket  IS DISTINCT FROM OLD.group_size_bucket
      OR NEW.budget_per_person  IS DISTINCT FROM OLD.budget_per_person
      OR NEW.trip_type          IS DISTINCT FROM OLD.trip_type;
  END IF;

  IF NOT v_inputs_changed THEN
    RETURN NEW;
  END IF;

  -- Inputs changed — invalidate the cache. Blanking the payload makes
  -- "cache miss" unambiguous on the client.
  NEW.cached_travel_suggestions          := NULL;
  NEW.cached_travel_suggestions_signature := NULL;
  NEW.cached_travel_suggestions_updated_at := NULL;

  -- suggest-travel needs at least destination + start_date to do anything
  -- useful. Skip warm-up otherwise.
  IF NEW.destination IS NULL OR NEW.start_date IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT decrypted_secret INTO v_service_key
  FROM   vault.decrypted_secrets
  WHERE  name = 'service_role_key'
  LIMIT  1;

  IF v_service_key IS NULL THEN
    RAISE WARNING 'trip_warm_travel_cache: service_role_key not in vault; skipping warm-up for trip %', NEW.id;
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url     := 'https://qxpbnixvjtwckuedlrfj.supabase.co/functions/v1/suggest-travel',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_service_key
    ),
    body    := jsonb_build_object('trip_id', NEW.id, 'warm', true)
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trip_warm_travel_cache_trg ON trips;
CREATE TRIGGER trip_warm_travel_cache_trg
  BEFORE INSERT OR UPDATE ON trips
  FOR EACH ROW
  EXECUTE FUNCTION trip_warm_travel_cache();
