-- ============================================================
-- Migration 044: Book-by date + nudge cadence schema
--
-- Foundations for the survey-based 1:1 SMS pivot. The conversational
-- phase machine is gone; what replaces it is a deterministic nudge
-- cadence keyed off a planner-set book-by date, plus a planner-side
-- recommendation queue for lock-in decisions.
--
-- Adds:
--   trips.book_by_date         — required at trip-launch time (nullable
--                                here so existing rows + draft trips
--                                stay valid; app enforces required)
--   trips.responses_due_date   — internal deadline; defaults to
--                                book_by_date - 3 days on insert/update
--                                via trigger but planner-overridable
--                                (the §8 "extend deadline" action)
--   trips.custom_intro_sms     — optional planner override for the
--                                initial outreach SMS body
--   trip_session_participants.last_activity_at
--                              — most recent inbound or survey activity
--                                touch; drives "responded 2h ago"
--   nudge_sends                — one row per scheduled or sent nudge,
--                                replaces the dropped scheduled_actions
--                                table with a survey-cadence shape
--   poll_recommendations       — Rally's proposal for a poll's lock,
--                                surfaces to the planner decision queue
--
-- All column adds are ADD COLUMN IF NOT EXISTS; all table creates are
-- CREATE TABLE IF NOT EXISTS. Idempotent — safe to re-run.
-- ============================================================


-- ─── 1. trips: book_by_date + responses_due_date + custom_intro_sms ─────────

ALTER TABLE trips
  ADD COLUMN IF NOT EXISTS book_by_date       date,
  ADD COLUMN IF NOT EXISTS responses_due_date date,
  ADD COLUMN IF NOT EXISTS custom_intro_sms   text;

-- Auto-default responses_due_date to book_by_date - 3 days when book_by_date
-- is set or changed AND the planner hasn't explicitly written a different
-- responses_due_date in the same statement. Detection rule: if NEW.responses_due_date
-- equals OLD.responses_due_date (or both NULL on insert), it's not being
-- written by the caller, so we recompute. If the caller wrote a value, leave it.
CREATE OR REPLACE FUNCTION trips_default_responses_due_date()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.book_by_date IS NULL THEN
    -- book-by cleared → clear derived deadline too unless caller overrode
    IF (TG_OP = 'INSERT') OR (NEW.responses_due_date IS NOT DISTINCT FROM OLD.responses_due_date) THEN
      NEW.responses_due_date := NULL;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.responses_due_date IS NULL THEN
      NEW.responses_due_date := NEW.book_by_date - 3;
    END IF;
  ELSE
    -- UPDATE: recompute only if book_by_date changed and caller didn't
    -- explicitly write a new responses_due_date in the same statement.
    IF NEW.book_by_date IS DISTINCT FROM OLD.book_by_date
       AND NEW.responses_due_date IS NOT DISTINCT FROM OLD.responses_due_date THEN
      NEW.responses_due_date := NEW.book_by_date - 3;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trips_default_responses_due_date ON trips;
CREATE TRIGGER trips_default_responses_due_date
  BEFORE INSERT OR UPDATE OF book_by_date, responses_due_date ON trips
  FOR EACH ROW EXECUTE FUNCTION trips_default_responses_due_date();

-- Sanity: responses_due cannot be after book_by (it's an *internal* deadline)
DO $$ BEGIN
  ALTER TABLE trips ADD CONSTRAINT trips_responses_due_le_book_by
    CHECK (
      responses_due_date IS NULL
      OR book_by_date IS NULL
      OR responses_due_date <= book_by_date
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ─── 2. trip_session_participants.last_activity_at ──────────────────────────

ALTER TABLE trip_session_participants
  ADD COLUMN IF NOT EXISTS last_activity_at timestamptz;


-- ─── 3. nudge_sends — scheduled + sent nudge tracking ───────────────────────
-- One row per (participant, nudge_type) instance. Scheduler inserts
-- rows with sent_at NULL; cron walks rows where scheduled_for <= now()
-- and sent_at IS NULL, fires the SMS, updates sent_at + message_sid.
-- Skipped rows get skipped_at + skip_reason instead of sent_at.

CREATE TABLE IF NOT EXISTS nudge_sends (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_session_id     uuid NOT NULL REFERENCES trip_sessions(id) ON DELETE CASCADE,
  participant_id      uuid REFERENCES trip_session_participants(id) ON DELETE CASCADE,
  nudge_type          text NOT NULL,
    -- 'initial' | 'd1' | 'd3' | 'heartbeat' | 'rd_minus_2' | 'rd_minus_1'
    -- | 'final' | 'manual' | 'lock_broadcast' | 'holdout_lock'
  scheduled_for       timestamptz NOT NULL,
  sent_at             timestamptz,
  skipped_at          timestamptz,
  skip_reason         text,
  message_sid         text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- Hot path: scheduler picks up due rows
CREATE INDEX IF NOT EXISTS idx_nudge_sends_due
  ON nudge_sends(scheduled_for)
  WHERE sent_at IS NULL AND skipped_at IS NULL;

-- Per-participant cadence view
CREATE INDEX IF NOT EXISTS idx_nudge_sends_participant
  ON nudge_sends(participant_id, scheduled_for);

-- Per-trip view (dashboard cadence card)
CREATE INDEX IF NOT EXISTS idx_nudge_sends_session
  ON nudge_sends(trip_session_id, scheduled_for);

-- Dedup guard: never schedule the same (participant, nudge_type) twice
-- unless the prior instance was skipped (planner pause then re-add).
CREATE UNIQUE INDEX IF NOT EXISTS idx_nudge_sends_pending_unique
  ON nudge_sends(trip_session_id, participant_id, nudge_type)
  WHERE sent_at IS NULL AND skipped_at IS NULL;


-- ─── 4. poll_recommendations — decision queue items ─────────────────────────
-- When responses cross a threshold (responses_due reached OR all participants
-- responded), Rally writes a recommendation row here. The planner dashboard
-- queries WHERE status = 'pending' for the decision queue. Approve/edit/hold
-- actions update status + locked_value + planner_action_at.

CREATE TABLE IF NOT EXISTS poll_recommendations (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id                uuid NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  trip_id                uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  recommended_option_id  uuid REFERENCES poll_options(id) ON DELETE SET NULL,
  recommendation_text    text NOT NULL,
  vote_breakdown         jsonb NOT NULL DEFAULT '{}'::jsonb,
    -- shape: { "<option_id>": <vote_count>, ... }
  holdout_participant_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  confidence             numeric(3,2),
    -- 0.00 to 1.00; null = no confidence signal computed
  status                 text NOT NULL DEFAULT 'pending',
    -- 'pending' | 'approved' | 'edited' | 'locked' | 'held' | 'superseded'
  locked_value           text,
    -- the actual value Rally broadcast on lock; may differ from
    -- recommendation_text if planner edited
  planner_action_at      timestamptz,
  planner_action_by      uuid REFERENCES users(id),
  hold_until             timestamptz,
    -- if status = 'held', when to re-surface (e.g. extended responses_due)
  created_at             timestamptz NOT NULL DEFAULT now()
);

-- Hot path: dashboard decision queue
CREATE INDEX IF NOT EXISTS idx_poll_recs_pending_per_trip
  ON poll_recommendations(trip_id, created_at DESC)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_poll_recs_poll
  ON poll_recommendations(poll_id, created_at DESC);

-- Only one pending recommendation per poll at a time. New recommendations
-- supersede the old (set status = 'superseded' first, then insert).
CREATE UNIQUE INDEX IF NOT EXISTS idx_poll_recs_one_pending
  ON poll_recommendations(poll_id)
  WHERE status = 'pending';


-- ─── 5. RLS ─────────────────────────────────────────────────────────────────

ALTER TABLE nudge_sends           ENABLE ROW LEVEL SECURITY;
ALTER TABLE poll_recommendations  ENABLE ROW LEVEL SECURITY;

-- nudge_sends: planners (and trip members) can read their trip's nudges.
-- Writes go through the scheduler (service role) only.
DO $$ BEGIN
  CREATE POLICY "nudge_sends_planner_read" ON nudge_sends
    FOR SELECT TO authenticated
    USING (
      EXISTS (
        SELECT 1
        FROM trip_sessions ts
        JOIN trip_members tm ON tm.trip_id = ts.trip_id
        WHERE ts.id = nudge_sends.trip_session_id
          AND tm.user_id = auth.uid()
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- poll_recommendations: trip members can read; planners (via RPC) update.
DO $$ BEGIN
  CREATE POLICY "poll_recs_member_read" ON poll_recommendations
    FOR SELECT TO authenticated
    USING (
      EXISTS (
        SELECT 1 FROM trip_members tm
        WHERE tm.trip_id = poll_recommendations.trip_id
          AND tm.user_id = auth.uid()
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
