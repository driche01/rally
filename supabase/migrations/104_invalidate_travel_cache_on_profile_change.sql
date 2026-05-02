-- ============================================================
-- Migration 104: Invalidate travel cache on traveler-profile changes
--
-- Background: the cache signature for travel suggestions
-- (suggest-travel.computeTravelSignature) hashes only trip-level
-- inputs — destination, dates, group size, budget, trip type. It
-- does NOT include the resolved origin (planner's home_airport)
-- or the aggregated dealbreakers/travel_pref. Result: when a
-- planner updates their home_airport, the cached "from <wrong
-- city>" payload (often a Gemini hallucination produced when the
-- airport was blank) keeps getting served until something else in
-- the signature changes.
--
-- Adding origin to the signature was rejected because the client
-- (TravelTab) computes the signature too and doesn't have the
-- planner's profile handy on every read. Cleaner fix: invalidate
-- via trigger. When relevant traveler_profile fields change, NULL
-- the cache columns on every trip that profile feeds into. Next
-- read mismatches → falls through to the edge function → recompute.
--
-- Affected trips:
--   * trips where the user is the planner (trips.created_by →
--     profiles.id → profiles.phone === traveler_profiles.phone)
--   * trips where the user is a respondent (respondents.phone ===
--     traveler_profiles.phone) — their dealbreakers/travel_pref
--     feed the group aggregation.
--
-- Lodging cache is NOT touched: its signature already includes
-- prefSummary.lastUpdatedAt (max(traveler_profiles.updated_at)
-- across the group), which advances on any profile update, so it
-- self-invalidates. Travel doesn't have an equivalent term.
--
-- Idempotent.
-- ============================================================

CREATE OR REPLACE FUNCTION invalidate_travel_cache_on_profile_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_relevant_change boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_relevant_change :=
         NEW.home_airport        IS NOT NULL
      OR COALESCE(array_length(NEW.flight_dealbreakers, 1), 0) > 0
      OR NEW.travel_pref         IS NOT NULL;
  ELSE
    v_relevant_change :=
         NEW.home_airport        IS DISTINCT FROM OLD.home_airport
      OR NEW.flight_dealbreakers IS DISTINCT FROM OLD.flight_dealbreakers
      OR NEW.travel_pref         IS DISTINCT FROM OLD.travel_pref;
  END IF;

  IF NOT v_relevant_change THEN
    RETURN NEW;
  END IF;

  -- Trips where this phone is the planner. profiles.phone is the
  -- canonical link from auth-user → traveler_profile.
  UPDATE trips t
  SET    cached_travel_suggestions           = NULL,
         cached_travel_suggestions_signature = NULL,
         cached_travel_suggestions_updated_at = NULL
  FROM   profiles p
  WHERE  p.id = t.created_by
    AND  p.phone = NEW.phone
    AND  t.cached_travel_suggestions_signature IS NOT NULL;

  -- Trips where this phone is a respondent. The respondents feed
  -- aggregated dealbreakers/travel_pref into the prompt, so any of
  -- those changing should bust the cache too.
  UPDATE trips t
  SET    cached_travel_suggestions           = NULL,
         cached_travel_suggestions_signature = NULL,
         cached_travel_suggestions_updated_at = NULL
  FROM   respondents r
  WHERE  r.trip_id = t.id
    AND  r.phone = NEW.phone
    AND  t.cached_travel_suggestions_signature IS NOT NULL;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS traveler_profiles_invalidate_travel_cache ON traveler_profiles;
CREATE TRIGGER traveler_profiles_invalidate_travel_cache
  AFTER INSERT OR UPDATE OF home_airport, flight_dealbreakers, travel_pref
  ON traveler_profiles
  FOR EACH ROW
  EXECUTE FUNCTION invalidate_travel_cache_on_profile_change();
