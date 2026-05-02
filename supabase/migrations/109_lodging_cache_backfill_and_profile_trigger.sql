-- ============================================================
-- Migration 103: Lodging-cache backfill + traveler-profile trigger
--
-- Two add-ons to migration 102's lodging-cache infrastructure:
--
--  1. Backfill — every active trip that already has destination +
--     start_date + end_date but no cached payload gets a one-shot
--     warm-up POST to suggest-lodging. The trigger from 102 only
--     fires on future updates, so without this trips that locked
--     their details before deploy stay cold until the planner edits
--     or opens the lodging tab.
--
--  2. traveler_profiles trigger — when a respondent flips their
--     lodging_pref or sleep_pref, the prefSummary in the suggestion
--     signature changes, which means every active trip the phone is
--     on now has a stale cache. Re-warm them via pg_net so the next
--     planner open is instant instead of waiting on a silent refresh.
--
-- Both reuse the existing service-role JWT in vault.secrets and the
-- same edge-function endpoint as migration 102.
-- ============================================================

-- ─── 1. Backfill eligible trips ─────────────────────────────────────────────
-- Skipped trips: status != 'active' (closed/done), already-cached, or
-- missing destination/dates. Service-role-key absence is logged-and-skipped
-- so the migration can still apply on environments without the vault entry.

DO $$
DECLARE
  v_trip_id      uuid;
  v_service_key  text;
  v_count        int := 0;
BEGIN
  SELECT decrypted_secret INTO v_service_key
  FROM   vault.decrypted_secrets
  WHERE  name = 'service_role_key'
  LIMIT  1;

  IF v_service_key IS NULL THEN
    RAISE WARNING 'service_role_key not in vault — skipping lodging-cache backfill';
    RETURN;
  END IF;

  FOR v_trip_id IN
    SELECT id
    FROM   trips
    WHERE  status = 'active'
      AND  destination IS NOT NULL
      AND  start_date  IS NOT NULL
      AND  end_date    IS NOT NULL
      AND  cached_lodging_suggestions IS NULL
  LOOP
    PERFORM net.http_post(
      url     := 'https://qxpbnixvjtwckuedlrfj.supabase.co/functions/v1/suggest-lodging',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || v_service_key
      ),
      body    := jsonb_build_object('trip_id', v_trip_id, 'warm', true)
    );
    v_count := v_count + 1;
  END LOOP;

  RAISE NOTICE 'lodging-cache backfill scheduled for % trip(s)', v_count;
END
$$;

-- ─── 2. traveler_profiles → re-warm affected trips ──────────────────────────
-- AFTER trigger because we're side-effecting via pg_net rather than
-- modifying NEW. We only act when one of the cache-signature inputs
-- changes (lodging_pref, sleep_pref). Other profile fields don't move
-- the signature so we ignore them to avoid unnecessary Gemini spend.
--
-- The edge function's signature check handles the rest: when the new
-- prefSummary differs from the cached one, it recomputes + writes back.
-- If the planner had already opened the tab in this signature window,
-- the request is effectively a no-op (cache stays as-is).

CREATE OR REPLACE FUNCTION traveler_profile_warm_lodging_cache()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_changed     boolean;
  v_trip_id     uuid;
  v_service_key text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_changed := true;
  ELSE
    v_changed :=
         NEW.lodging_pref IS DISTINCT FROM OLD.lodging_pref
      OR NEW.sleep_pref   IS DISTINCT FROM OLD.sleep_pref;
  END IF;

  IF NOT v_changed THEN
    RETURN NEW;
  END IF;

  SELECT decrypted_secret INTO v_service_key
  FROM   vault.decrypted_secrets
  WHERE  name = 'service_role_key'
  LIMIT  1;

  IF v_service_key IS NULL THEN
    RAISE WARNING 'service_role_key not in vault — skipping profile-driven cache warm';
    RETURN NEW;
  END IF;

  -- Every active trip this phone is a respondent on, joined by phone
  -- (the same key the cache signature uses to aggregate prefs).
  FOR v_trip_id IN
    SELECT DISTINCT t.id
    FROM   respondents r
    JOIN   trips       t ON t.id = r.trip_id
    WHERE  r.phone      = NEW.phone
      AND  t.status     = 'active'
      AND  t.destination IS NOT NULL
      AND  t.start_date  IS NOT NULL
      AND  t.end_date    IS NOT NULL
  LOOP
    PERFORM net.http_post(
      url     := 'https://qxpbnixvjtwckuedlrfj.supabase.co/functions/v1/suggest-lodging',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || v_service_key
      ),
      body    := jsonb_build_object('trip_id', v_trip_id, 'warm', true)
    );
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS traveler_profile_warm_lodging_cache_trg ON traveler_profiles;
CREATE TRIGGER traveler_profile_warm_lodging_cache_trg
  AFTER INSERT OR UPDATE ON traveler_profiles
  FOR EACH ROW
  EXECUTE FUNCTION traveler_profile_warm_lodging_cache();
