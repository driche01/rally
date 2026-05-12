-- ============================================================
-- Migration 134: Phase B — AI generation log
--
-- §7 addition to the Phase B plan (not in the build guide). Tracks
-- every AI generation across providers so route handlers can enforce
-- per-trip / per-day caps before token cost spirals during alpha.
--
-- caller_user_id FKs profiles(id) — generation requests are gated to
-- authed planners + cohosts, never anon, so the auth-side identity
-- is the right grain.
-- ============================================================

CREATE TABLE IF NOT EXISTS phase_b_generation_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id         uuid REFERENCES trips(id) ON DELETE SET NULL,
  caller_user_id  uuid REFERENCES profiles(id) ON DELETE SET NULL,
  kind            text NOT NULL,
  provider        text NOT NULL,
  model           text NOT NULL,
  input_tokens    integer,
  output_tokens   integer,
  duration_ms     integer,
  error_code      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT phase_b_gen_log_kind_check
    CHECK (kind IN (
      'itinerary_generate','lodging_suggest','flight_suggest',
      'meal_plan_generate','ingredient_normalize',
      'cover_image_generate','flyer_render'
    )),
  CONSTRAINT phase_b_gen_log_provider_check
    CHECK (provider IN ('anthropic','gemini','self'))
);

CREATE INDEX IF NOT EXISTS idx_phase_b_gen_log_trip_day
  ON phase_b_generation_log (trip_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_phase_b_gen_log_kind_day
  ON phase_b_generation_log (kind, created_at DESC);

INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES ('134', 'phase_b_generation_log', ARRAY[]::text[])
ON CONFLICT (version) DO NOTHING;
