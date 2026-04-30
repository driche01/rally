-- ============================================================
-- Migration 062: traveler_profiles
--
-- Per-respondent profile of preferences captured at the end of any
-- Rally survey. Keyed off phone (E.164). Persists across trips so a
-- returning respondent reviews/updates their answers instead of
-- re-entering them. Planners of trips the phone is on can read the
-- profile (RLS-gated). Anon respondents read/write through SECURITY
-- DEFINER RPCs that verify the phone is on a session for a given
-- share_token before granting access.
--
-- The 13 questions are ordered into two on-screen pages:
--   Page A: ✈️ Travel + 🏡 Lodging + 🍽️ Dining
--   Page B: 🎯 Activities + 💰 Budget + Optional notes
-- ============================================================

CREATE TABLE traveler_profiles (
  phone text PRIMARY KEY,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,

  -- ✈️ Travel
  home_airport text,
  travel_pref text,                                  -- 'with_group' | 'with_group_flexible' | 'separate' | 'no_pref'
  flight_dealbreakers text[] DEFAULT '{}'::text[],   -- ['red_eye','multi_stop','early_dep','late_arr'] OR empty/none for "flexible"

  -- 🏡 Lodging
  sleep_pref text,                                   -- 'own_room' | 'own_bed' | 'share_bed' | 'flexible'
  lodging_pref text,                                 -- 'hotel' | 'rental' | 'either'

  -- 🍽️ Dining
  dietary_restrictions text[] DEFAULT '{}'::text[],  -- ['vegetarian','vegan','gluten_free','dairy_free','allergies','other']
  dietary_specifics text,                            -- freeform: filled when 'allergies' or 'other' picked
  meal_pref text,                                    -- 'eat_out' | 'mixed' | 'cook_in' | 'no_pref'
  drinking_pref text,                                -- 'drinker_central' | 'casual' | 'sober_friendly' | 'low_no'

  -- 🎯 Activities
  physical_limitations text[] DEFAULT '{}'::text[],  -- ['limited_walking','avoid_water','avoid_intense','other']
  physical_specifics text,                           -- freeform when 'other' picked
  trip_pace integer CHECK (trip_pace BETWEEN 1 AND 4),
  activity_types text[] DEFAULT '{}'::text[],       -- max 2: ['food','sightseeing','culture','outdoor','nightlife','wellness']

  -- 💰 Budget
  budget_posture text,                               -- 'splurge' | 'middle' | 'budget' | 'flexible'

  -- Optional
  notes text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX traveler_profiles_user_id_idx ON traveler_profiles(user_id);

-- updated_at trigger
CREATE OR REPLACE FUNCTION update_traveler_profile_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER traveler_profiles_updated_at
  BEFORE UPDATE ON traveler_profiles
  FOR EACH ROW EXECUTE FUNCTION update_traveler_profile_updated_at();

-- ─── RLS ─────────────────────────────────────────────────────────────────────
-- Default deny. Two access patterns:
--   1. Planner of a trip the phone is on → SELECT via RLS (auth.uid() === trip member)
--   2. Anon respondent → read/write via SECURITY DEFINER RPCs below
ALTER TABLE traveler_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "planners read profiles of their trip participants"
  ON traveler_profiles FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM trip_session_participants p
      JOIN trip_sessions s ON s.id = p.trip_session_id
      JOIN trip_members m  ON m.trip_id = s.trip_id
      WHERE p.phone = traveler_profiles.phone
        AND m.user_id = auth.uid()
    )
  );

-- ─── Anon RPC: read profile by share_token + phone ───────────────────────────
-- The respondent doesn't have an auth identity. They prove access by
-- knowing both the share_token (from their SMS link) and the phone they
-- entered into the survey. The RPC verifies the phone is on the trip's
-- active session for that token before returning anything.

CREATE OR REPLACE FUNCTION get_traveler_profile_by_token(
  p_share_token text,
  p_phone       text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_authorized boolean;
  v_row        traveler_profiles%ROWTYPE;
BEGIN
  IF p_share_token IS NULL OR p_phone IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM trip_session_participants p
    JOIN trip_sessions s ON s.id = p.trip_session_id
    JOIN trips t         ON t.id = s.trip_id
    WHERE t.share_token = p_share_token
      AND p.phone = p_phone
  ) INTO v_authorized;

  IF NOT v_authorized THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_row FROM traveler_profiles WHERE phone = p_phone;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN to_jsonb(v_row);
END;
$$;

GRANT EXECUTE ON FUNCTION get_traveler_profile_by_token(text, text) TO anon, authenticated;

-- ─── Anon RPC: upsert profile by share_token + phone ─────────────────────────
-- Same authorization gate. Only updates fields explicitly present in the
-- JSON payload (PATCH semantics) so a returning respondent updating one
-- field doesn't blank the others.

CREATE OR REPLACE FUNCTION upsert_traveler_profile_by_token(
  p_share_token text,
  p_phone       text,
  p_profile     jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_authorized boolean;
  v_row        traveler_profiles%ROWTYPE;
BEGIN
  IF p_share_token IS NULL OR p_phone IS NULL OR p_profile IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_args');
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM trip_session_participants p
    JOIN trip_sessions s ON s.id = p.trip_session_id
    JOIN trips t         ON t.id = s.trip_id
    WHERE t.share_token = p_share_token
      AND p.phone = p_phone
  ) INTO v_authorized;

  IF NOT v_authorized THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  -- Insert with COALESCE-from-payload, falling back to existing on update.
  -- jsonb keys with explicit null intentionally clear the column.
  INSERT INTO traveler_profiles (
    phone,
    home_airport,
    travel_pref,
    flight_dealbreakers,
    sleep_pref,
    lodging_pref,
    dietary_restrictions,
    dietary_specifics,
    meal_pref,
    drinking_pref,
    physical_limitations,
    physical_specifics,
    trip_pace,
    activity_types,
    budget_posture,
    notes
  ) VALUES (
    p_phone,
    p_profile->>'home_airport',
    p_profile->>'travel_pref',
    COALESCE((SELECT array_agg(value::text) FROM jsonb_array_elements_text(p_profile->'flight_dealbreakers')), '{}'::text[]),
    p_profile->>'sleep_pref',
    p_profile->>'lodging_pref',
    COALESCE((SELECT array_agg(value::text) FROM jsonb_array_elements_text(p_profile->'dietary_restrictions')), '{}'::text[]),
    p_profile->>'dietary_specifics',
    p_profile->>'meal_pref',
    p_profile->>'drinking_pref',
    COALESCE((SELECT array_agg(value::text) FROM jsonb_array_elements_text(p_profile->'physical_limitations')), '{}'::text[]),
    p_profile->>'physical_specifics',
    NULLIF(p_profile->>'trip_pace', '')::int,
    COALESCE((SELECT array_agg(value::text) FROM jsonb_array_elements_text(p_profile->'activity_types')), '{}'::text[]),
    p_profile->>'budget_posture',
    p_profile->>'notes'
  )
  ON CONFLICT (phone) DO UPDATE SET
    home_airport         = EXCLUDED.home_airport,
    travel_pref          = EXCLUDED.travel_pref,
    flight_dealbreakers  = EXCLUDED.flight_dealbreakers,
    sleep_pref           = EXCLUDED.sleep_pref,
    lodging_pref         = EXCLUDED.lodging_pref,
    dietary_restrictions = EXCLUDED.dietary_restrictions,
    dietary_specifics    = EXCLUDED.dietary_specifics,
    meal_pref            = EXCLUDED.meal_pref,
    drinking_pref        = EXCLUDED.drinking_pref,
    physical_limitations = EXCLUDED.physical_limitations,
    physical_specifics   = EXCLUDED.physical_specifics,
    trip_pace            = EXCLUDED.trip_pace,
    activity_types       = EXCLUDED.activity_types,
    budget_posture       = EXCLUDED.budget_posture,
    notes                = EXCLUDED.notes
  RETURNING * INTO v_row;

  RETURN jsonb_build_object('ok', true, 'profile', to_jsonb(v_row));
END;
$$;

GRANT EXECUTE ON FUNCTION upsert_traveler_profile_by_token(text, text, jsonb) TO anon, authenticated;
