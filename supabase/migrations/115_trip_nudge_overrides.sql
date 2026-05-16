-- ============================================================
-- Migration 115: trip_nudge_overrides — per-trip × per-kind SMS body overrides
--
-- Lets a planner edit the literal SMS body that goes out for any
-- nudge round on a given trip (e.g. "Second nudge", "Check-in").
-- The cadence + scheduled times stay deterministic; only the body
-- text changes.
--
-- Token expansion at send time (see _sms-shared/personalize.ts):
--   [Name] [Planner] [Destination] [Trip] [Survey link]
-- (Social-proof clauses like "Alex and Sam have answered, 3 left."
-- are dropped when an override exists — the override is what goes out.)
--
-- 'initial' is also accepted in this table; sms-nudge-scheduler
-- prefers an override here over the legacy `trips.custom_intro_sms`
-- column for the initial outreach.
-- ============================================================

CREATE TABLE IF NOT EXISTS trip_nudge_overrides (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id     uuid        NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  nudge_kind  text        NOT NULL,
  body        text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trip_nudge_overrides_kind_check CHECK (
    nudge_kind IN ('initial','d1','d3','heartbeat','rd_minus_2','rd_minus_1')
  ),
  CONSTRAINT trip_nudge_overrides_body_nonempty CHECK (length(trim(body)) > 0),
  UNIQUE (trip_id, nudge_kind)
);

CREATE INDEX IF NOT EXISTS idx_trip_nudge_overrides_trip
  ON trip_nudge_overrides (trip_id);

-- Touch updated_at on UPDATE so the dashboard can show "edited 2h ago"
-- if we ever want to surface that.
CREATE OR REPLACE FUNCTION trip_nudge_overrides_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trip_nudge_overrides_touch_updated_at_t ON trip_nudge_overrides;
CREATE TRIGGER trip_nudge_overrides_touch_updated_at_t
BEFORE UPDATE ON trip_nudge_overrides
FOR EACH ROW EXECUTE FUNCTION trip_nudge_overrides_touch_updated_at();


-- ─── RLS ────────────────────────────────────────────────────────────────────
-- Planner-only. Mirrors the trip_audit_events pattern from migration 089:
-- only the trip's planner (role='planner' on trip_members) can read/write.

ALTER TABLE trip_nudge_overrides ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "trip_nudge_overrides_planner_read" ON trip_nudge_overrides
    FOR SELECT TO authenticated USING (
      EXISTS (
        SELECT 1 FROM trip_members tm
        WHERE tm.trip_id = trip_nudge_overrides.trip_id
          AND tm.user_id = auth.uid()
          AND tm.role    = 'planner'
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "trip_nudge_overrides_planner_write" ON trip_nudge_overrides
    FOR INSERT TO authenticated WITH CHECK (
      EXISTS (
        SELECT 1 FROM trip_members tm
        WHERE tm.trip_id = trip_nudge_overrides.trip_id
          AND tm.user_id = auth.uid()
          AND tm.role    = 'planner'
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "trip_nudge_overrides_planner_update" ON trip_nudge_overrides
    FOR UPDATE TO authenticated USING (
      EXISTS (
        SELECT 1 FROM trip_members tm
        WHERE tm.trip_id = trip_nudge_overrides.trip_id
          AND tm.user_id = auth.uid()
          AND tm.role    = 'planner'
      )
    ) WITH CHECK (
      EXISTS (
        SELECT 1 FROM trip_members tm
        WHERE tm.trip_id = trip_nudge_overrides.trip_id
          AND tm.user_id = auth.uid()
          AND tm.role    = 'planner'
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "trip_nudge_overrides_planner_delete" ON trip_nudge_overrides
    FOR DELETE TO authenticated USING (
      EXISTS (
        SELECT 1 FROM trip_members tm
        WHERE tm.trip_id = trip_nudge_overrides.trip_id
          AND tm.user_id = auth.uid()
          AND tm.role    = 'planner'
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
