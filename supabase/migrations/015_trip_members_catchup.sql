-- Catchup migration for trip_members table.
-- The table was created outside the tracked migration system; this migration
-- is fully idempotent so it applies cleanly on any environment.

CREATE TABLE IF NOT EXISTS trip_members (
  id        UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  trip_id   UUID        NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  user_id   UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role      TEXT        NOT NULL DEFAULT 'member' CHECK (role IN ('planner', 'member')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (trip_id, user_id)
);

ALTER TABLE trip_members ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "trip_members_insert" ON trip_members
    FOR INSERT WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "trip_members_select" ON trip_members
    FOR SELECT USING (
      auth.uid() = user_id
      OR EXISTS (
        SELECT 1 FROM trips
        WHERE trips.id = trip_members.trip_id
          AND trips.created_by = auth.uid()
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "trip_members_delete" ON trip_members
    FOR DELETE USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS trip_members_trip_id_idx ON trip_members(trip_id);
CREATE INDEX IF NOT EXISTS trip_members_user_id_idx ON trip_members(user_id);
