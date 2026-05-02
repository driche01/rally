-- ============================================================
-- Migration 102: Server-side cache for lodging suggestions
--
-- Why: when a planner opens the Lodging tab, suggestions should
-- render instantly — no spinner, no Gemini round-trip. We cache
-- the suggestion payload on the trip row, gated by a signature
-- of the inputs that produced it (destination, dates, group
-- size, budget, flight estimate, traveler-profile prefs). When
-- inputs change the signature flips; the next read computes
-- fresh and writes the new entry back.
--
-- The trigger below fires `suggest-lodging` via pg_net the
-- moment trip details first lock in (destination + dates) so
-- the cache is warm before the planner ever taps Lodging. Fire-
-- and-forget — pg_net schedules the request and a background
-- worker delivers it after this transaction commits.
--
-- Cache column writes themselves do NOT re-enter the trigger
-- (only input columns are watched), so there is no recursion.
-- ============================================================

ALTER TABLE trips
  ADD COLUMN IF NOT EXISTS cached_lodging_suggestions          jsonb,
  ADD COLUMN IF NOT EXISTS cached_lodging_suggestions_signature text,
  ADD COLUMN IF NOT EXISTS cached_lodging_suggestions_updated_at timestamptz;

COMMENT ON COLUMN trips.cached_lodging_suggestions IS
  'Cached LodgingSuggestionsResult payload. Populated by suggest-lodging edge function; read directly by the client for instant render.';
COMMENT ON COLUMN trips.cached_lodging_suggestions_signature IS
  'Signature of the inputs used to compute the cached payload. Cache is valid when this matches the current input signature.';

-- ─── Trigger: warm the lodging cache on details change ───────────────────────
--
-- Fires on UPDATE of the inputs that suggest-lodging consumes. Clears the
-- cache columns and, if the trip now has the minimum required fields
-- (destination + start + end), schedules an HTTP POST to suggest-lodging via
-- pg_net. The edge function then computes + writes the cache back.
--
-- We deliberately do NOT include traveler_profiles here — pref changes are
-- handled by the edge function recomputing on signature mismatch on next
-- read. If we want pre-warming there too, add a sibling trigger on
-- traveler_profiles in a follow-up.

CREATE OR REPLACE FUNCTION trip_warm_lodging_cache()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inputs_changed boolean := false;
  v_service_key    text;
BEGIN
  -- INSERT path: always treat as "inputs new" so a trip created with
  -- destination + dates already set warms the cache.
  IF TG_OP = 'INSERT' THEN
    v_inputs_changed := true;
  ELSE
    v_inputs_changed :=
      NEW.destination                        IS DISTINCT FROM OLD.destination
      OR NEW.start_date                      IS DISTINCT FROM OLD.start_date
      OR NEW.end_date                        IS DISTINCT FROM OLD.end_date
      OR NEW.group_size_precise              IS DISTINCT FROM OLD.group_size_precise
      OR NEW.group_size_bucket               IS DISTINCT FROM OLD.group_size_bucket
      OR NEW.budget_per_person               IS DISTINCT FROM OLD.budget_per_person
      OR NEW.estimated_flight_cost_per_person IS DISTINCT FROM OLD.estimated_flight_cost_per_person
      OR NEW.trip_type                       IS DISTINCT FROM OLD.trip_type;
  END IF;

  IF NOT v_inputs_changed THEN
    RETURN NEW;
  END IF;

  -- Inputs changed — invalidate the cache. The signature mismatch alone
  -- would force a recompute on next read, but blanking the payload makes
  -- "cache miss" unambiguous on the client (avoids rendering stale data
  -- while the new compute is in flight).
  NEW.cached_lodging_suggestions          := NULL;
  NEW.cached_lodging_suggestions_signature := NULL;
  NEW.cached_lodging_suggestions_updated_at := NULL;

  -- Need destination + both dates to compute. Skip otherwise.
  IF NEW.destination IS NULL OR NEW.start_date IS NULL OR NEW.end_date IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT decrypted_secret INTO v_service_key
  FROM   vault.decrypted_secrets
  WHERE  name = 'service_role_key'
  LIMIT  1;

  IF v_service_key IS NULL THEN
    RAISE WARNING 'trip_warm_lodging_cache: service_role_key not in vault; skipping warm-up for trip %', NEW.id;
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url     := 'https://qxpbnixvjtwckuedlrfj.supabase.co/functions/v1/suggest-lodging',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_service_key
    ),
    body    := jsonb_build_object('trip_id', NEW.id, 'warm', true)
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trip_warm_lodging_cache_trg ON trips;
CREATE TRIGGER trip_warm_lodging_cache_trg
  BEFORE INSERT OR UPDATE ON trips
  FOR EACH ROW
  EXECUTE FUNCTION trip_warm_lodging_cache();
