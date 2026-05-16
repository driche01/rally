-- ============================================================
-- Migration 135: Phase C — trip cancellation columns
--
-- Phase C ships the Cancel Trip flow (build guide §8, deferred
-- from Phase A). Setting cancelled_at locks the trip in a
-- "Cancelled" state; the API layer gates writes via
--   if (trip.cancelled_at) return 410 gone
-- (see PHASE_C_PRE_BUILD_REVIEW.md C10).
--
-- cancelled_by → profiles(id) per Q1.
-- ============================================================

ALTER TABLE trips
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid NULL REFERENCES profiles(id);

-- Partial index for the common "show me active trips" query path.
CREATE INDEX IF NOT EXISTS idx_trips_active
  ON trips(id)
  WHERE cancelled_at IS NULL;

INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES ('135', 'phase_c_trips_cancelled', ARRAY[]::text[])
ON CONFLICT (version) DO NOTHING;
