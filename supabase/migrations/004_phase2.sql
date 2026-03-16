-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 004: Phase 2 — Logistics Engine
-- ─────────────────────────────────────────────────────────────────────────────


-- ─── TRIPS: Phase 2 columns ───────────────────────────────────────────────────

ALTER TABLE trips
  ADD COLUMN start_date            DATE,
  ADD COLUMN end_date              DATE,
  ADD COLUMN phase2_unlocked       BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN phase2_unlocked_at    TIMESTAMPTZ,
  ADD COLUMN phase2_unlock_method  TEXT CHECK (phase2_unlock_method IN ('iap', 'code', 'free'));


-- ─── PUSH TOKENS ──────────────────────────────────────────────────────────────

CREATE TABLE push_tokens (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  token       TEXT        NOT NULL,
  platform    TEXT        NOT NULL CHECK (platform IN ('ios', 'android')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, token)
);

ALTER TABLE push_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own push tokens"
  ON push_tokens FOR ALL USING (auth.uid() = user_id);

CREATE INDEX push_tokens_user_id_idx ON push_tokens(user_id);

CREATE TRIGGER push_tokens_updated_at
  BEFORE UPDATE ON push_tokens
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at();


-- ─── LODGING OPTIONS ──────────────────────────────────────────────────────────
-- Created before itinerary_blocks so the FK can reference it.

CREATE TABLE lodging_options (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id              UUID        NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  platform             TEXT        NOT NULL CHECK (platform IN ('airbnb', 'vrbo', 'booking', 'manual')),
  title                TEXT        NOT NULL CHECK (char_length(title) <= 150),
  url                  TEXT,
  notes                TEXT        CHECK (char_length(notes) <= 500),
  check_in_date        DATE,
  check_out_date       DATE,
  check_in_time        TIME,
  check_out_time       TIME,
  total_cost_cents     INTEGER     CHECK (total_cost_cents >= 0),
  nightly_rate_cents   INTEGER     CHECK (nightly_rate_cents >= 0),
  status               TEXT        NOT NULL DEFAULT 'option' CHECK (status IN ('option', 'voted', 'booked')),
  booking_confirmation TEXT,
  position             INTEGER     NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE lodging_options ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Planners can manage lodging options for their trips"
  ON lodging_options FOR ALL USING (
    EXISTS (SELECT 1 FROM trips WHERE trips.id = lodging_options.trip_id AND trips.created_by = auth.uid())
  );

CREATE POLICY "Anyone can read lodging options"
  ON lodging_options FOR SELECT USING (true);

CREATE INDEX lodging_options_trip_id_idx ON lodging_options(trip_id);

CREATE TRIGGER lodging_options_updated_at
  BEFORE UPDATE ON lodging_options
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at();


-- ─── ITINERARY BLOCKS ─────────────────────────────────────────────────────────

CREATE TABLE itinerary_blocks (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id           UUID        NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  day_date          DATE        NOT NULL,
  type              TEXT        NOT NULL CHECK (type IN ('activity', 'meal', 'travel', 'accommodation', 'free_time')),
  title             TEXT        NOT NULL CHECK (char_length(title) <= 100),
  start_time        TIME,
  end_time          TIME,
  location          TEXT        CHECK (char_length(location) <= 200),
  notes             TEXT        CHECK (char_length(notes) <= 1000),
  position          INTEGER     NOT NULL DEFAULT 0,
  attendee_ids      UUID[],     -- NULL means all group members
  lodging_option_id UUID        REFERENCES lodging_options(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE itinerary_blocks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Planners can manage itinerary blocks for their trips"
  ON itinerary_blocks FOR ALL USING (
    EXISTS (SELECT 1 FROM trips WHERE trips.id = itinerary_blocks.trip_id AND trips.created_by = auth.uid())
  );

CREATE POLICY "Anyone can read itinerary blocks"
  ON itinerary_blocks FOR SELECT USING (true);

CREATE INDEX itinerary_blocks_trip_id_idx   ON itinerary_blocks(trip_id);
CREATE INDEX itinerary_blocks_day_date_idx  ON itinerary_blocks(trip_id, day_date);

CREATE TRIGGER itinerary_blocks_updated_at
  BEFORE UPDATE ON itinerary_blocks
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at();


-- ─── DAY RSVPs ────────────────────────────────────────────────────────────────

CREATE TABLE day_rsvps (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id        UUID        NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  respondent_id  UUID        NOT NULL REFERENCES respondents(id) ON DELETE CASCADE,
  day_date       DATE        NOT NULL,
  status         TEXT        NOT NULL CHECK (status IN ('going', 'not_sure', 'cant_make_it')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (trip_id, respondent_id, day_date)
);

ALTER TABLE day_rsvps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Planners can read RSVPs for their trips"
  ON day_rsvps FOR SELECT USING (
    EXISTS (SELECT 1 FROM trips WHERE trips.id = day_rsvps.trip_id AND trips.created_by = auth.uid())
  );

CREATE POLICY "Anyone can read day RSVPs"
  ON day_rsvps FOR SELECT USING (true);

CREATE POLICY "Anyone can insert a day RSVP"
  ON day_rsvps FOR INSERT WITH CHECK (true);

CREATE POLICY "Anyone can update a day RSVP"
  ON day_rsvps FOR UPDATE USING (true);

CREATE INDEX day_rsvps_trip_id_idx   ON day_rsvps(trip_id);
CREATE INDEX day_rsvps_day_date_idx  ON day_rsvps(trip_id, day_date);

CREATE TRIGGER day_rsvps_updated_at
  BEFORE UPDATE ON day_rsvps
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at();


-- ─── LODGING VOTES ────────────────────────────────────────────────────────────

CREATE TABLE lodging_votes (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  lodging_option_id UUID        NOT NULL REFERENCES lodging_options(id) ON DELETE CASCADE,
  trip_id           UUID        NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  respondent_id     UUID        NOT NULL REFERENCES respondents(id) ON DELETE CASCADE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (lodging_option_id, respondent_id)
);

ALTER TABLE lodging_votes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Planners can read lodging votes for their trips"
  ON lodging_votes FOR SELECT USING (
    EXISTS (SELECT 1 FROM trips WHERE trips.id = lodging_votes.trip_id AND trips.created_by = auth.uid())
  );

CREATE POLICY "Anyone can read lodging votes"
  ON lodging_votes FOR SELECT USING (true);

CREATE POLICY "Anyone can insert a lodging vote"
  ON lodging_votes FOR INSERT WITH CHECK (true);

CREATE POLICY "Anyone can delete their own lodging vote"
  ON lodging_votes FOR DELETE USING (true);

CREATE INDEX lodging_votes_option_id_idx ON lodging_votes(lodging_option_id);
CREATE INDEX lodging_votes_trip_id_idx   ON lodging_votes(trip_id);


-- ─── TRIP MESSAGES ────────────────────────────────────────────────────────────

CREATE TABLE trip_messages (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id            UUID        NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  sender_id          UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  content            TEXT        NOT NULL CHECK (char_length(content) >= 1 AND char_length(content) <= 1000),
  itinerary_block_id UUID        REFERENCES itinerary_blocks(id) ON DELETE SET NULL,
  is_pinned          BOOLEAN     NOT NULL DEFAULT false,
  read_count         INTEGER     NOT NULL DEFAULT 0 CHECK (read_count >= 0),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE trip_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Planners can manage messages for their trips"
  ON trip_messages FOR ALL USING (
    EXISTS (SELECT 1 FROM trips WHERE trips.id = trip_messages.trip_id AND trips.created_by = auth.uid())
  );

CREATE POLICY "Anyone can read trip messages"
  ON trip_messages FOR SELECT USING (true);

CREATE INDEX trip_messages_trip_id_idx  ON trip_messages(trip_id);
CREATE INDEX trip_messages_created_idx  ON trip_messages(trip_id, created_at DESC);

CREATE TRIGGER trip_messages_updated_at
  BEFORE UPDATE ON trip_messages
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at();


-- ─── MESSAGE REACTIONS ────────────────────────────────────────────────────────

CREATE TABLE message_reactions (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id    UUID        NOT NULL REFERENCES trip_messages(id) ON DELETE CASCADE,
  reactor_type  TEXT        NOT NULL CHECK (reactor_type IN ('planner', 'respondent')),
  reactor_id    UUID        NOT NULL,
  emoji         TEXT        NOT NULL CHECK (char_length(emoji) <= 8),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (message_id, reactor_id, emoji)
);

ALTER TABLE message_reactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read message reactions"
  ON message_reactions FOR SELECT USING (true);

CREATE POLICY "Anyone can insert a reaction"
  ON message_reactions FOR INSERT WITH CHECK (true);

CREATE POLICY "Anyone can delete their own reaction"
  ON message_reactions FOR DELETE USING (true);

CREATE INDEX message_reactions_message_id_idx ON message_reactions(message_id);


-- ─── DISCOUNT CODES ───────────────────────────────────────────────────────────

CREATE TABLE discount_codes (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  code            TEXT        NOT NULL UNIQUE CHECK (char_length(code) BETWEEN 3 AND 30),
  discount_type   TEXT        NOT NULL CHECK (discount_type IN ('percentage', 'flat', 'full')),
  -- percentage: 1–100 | flat: amount in cents | full: 0 (100% off, bypasses IAP)
  discount_value  INTEGER     NOT NULL DEFAULT 0 CHECK (discount_value >= 0),
  max_uses        INTEGER     NOT NULL DEFAULT 1 CHECK (max_uses >= 1),
  use_count       INTEGER     NOT NULL DEFAULT 0 CHECK (use_count >= 0),
  expires_at      TIMESTAMPTZ,
  is_active       BOOLEAN     NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE discount_codes ENABLE ROW LEVEL SECURITY;

-- Planners can read active codes to validate them at the paywall
CREATE POLICY "Anyone can read active discount codes"
  ON discount_codes FOR SELECT USING (is_active = true);


-- ─── DISCOUNT CODE REDEMPTIONS ────────────────────────────────────────────────

CREATE TABLE discount_code_redemptions (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  code_id                UUID        NOT NULL REFERENCES discount_codes(id) ON DELETE CASCADE,
  planner_id             UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  trip_id                UUID        NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  discount_applied_cents INTEGER     NOT NULL DEFAULT 0 CHECK (discount_applied_cents >= 0),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (code_id, trip_id)  -- one code per trip
);

ALTER TABLE discount_code_redemptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Planners can read their own redemptions"
  ON discount_code_redemptions FOR SELECT USING (auth.uid() = planner_id);

CREATE POLICY "Planners can insert redemptions"
  ON discount_code_redemptions FOR INSERT WITH CHECK (auth.uid() = planner_id);

CREATE INDEX discount_code_redemptions_code_id_idx     ON discount_code_redemptions(code_id);
CREATE INDEX discount_code_redemptions_planner_id_idx  ON discount_code_redemptions(planner_id);


-- ─── EXPENSES ─────────────────────────────────────────────────────────────────

CREATE TABLE expenses (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id               UUID        NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  description           TEXT        NOT NULL CHECK (char_length(description) BETWEEN 1 AND 200),
  category              TEXT        NOT NULL CHECK (category IN ('accommodation', 'food', 'transport', 'activities', 'gear', 'other')),
  amount_cents          INTEGER     NOT NULL CHECK (amount_cents > 0),
  paid_by_planner_id    UUID        REFERENCES profiles(id)    ON DELETE SET NULL,
  paid_by_respondent_id UUID        REFERENCES respondents(id) ON DELETE SET NULL,
  itinerary_block_id    UUID        REFERENCES itinerary_blocks(id) ON DELETE SET NULL,
  lodging_option_id     UUID        REFERENCES lodging_options(id)  ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Exactly one payer required
  CHECK (
    (paid_by_planner_id IS NOT NULL AND paid_by_respondent_id IS NULL) OR
    (paid_by_planner_id IS NULL     AND paid_by_respondent_id IS NOT NULL)
  )
);

ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Planners can manage expenses for their trips"
  ON expenses FOR ALL USING (
    EXISTS (SELECT 1 FROM trips WHERE trips.id = expenses.trip_id AND trips.created_by = auth.uid())
  );

CREATE POLICY "Anyone can read expenses"
  ON expenses FOR SELECT USING (true);

CREATE POLICY "Anyone can insert expenses"
  ON expenses FOR INSERT WITH CHECK (true);

CREATE INDEX expenses_trip_id_idx ON expenses(trip_id);

CREATE TRIGGER expenses_updated_at
  BEFORE UPDATE ON expenses
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at();


-- ─── EXPENSE SPLITS ───────────────────────────────────────────────────────────

CREATE TABLE expense_splits (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id           UUID        NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  amount_cents         INTEGER     NOT NULL CHECK (amount_cents >= 0),
  split_planner_id     UUID        REFERENCES profiles(id)    ON DELETE SET NULL,
  split_respondent_id  UUID        REFERENCES respondents(id) ON DELETE SET NULL,
  is_settled           BOOLEAN     NOT NULL DEFAULT false,
  settled_at           TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Exactly one split recipient required
  CHECK (
    (split_planner_id IS NOT NULL AND split_respondent_id IS NULL) OR
    (split_planner_id IS NULL     AND split_respondent_id IS NOT NULL)
  )
);

ALTER TABLE expense_splits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Planners can manage splits for their trip expenses"
  ON expense_splits FOR ALL USING (
    EXISTS (
      SELECT 1 FROM expenses
      JOIN trips ON trips.id = expenses.trip_id
      WHERE expenses.id = expense_splits.expense_id
        AND trips.created_by = auth.uid()
    )
  );

CREATE POLICY "Anyone can read expense splits"
  ON expense_splits FOR SELECT USING (true);

CREATE POLICY "Anyone can insert expense splits"
  ON expense_splits FOR INSERT WITH CHECK (true);

CREATE INDEX expense_splits_expense_id_idx ON expense_splits(expense_id);


-- ─── RPC FUNCTIONS ────────────────────────────────────────────────────────────

-- Atomically increments trip_messages.read_count for a given message.
-- Using UPDATE ... SET col = col + 1 is atomic at the row level and avoids
-- read-then-write races when multiple clients open the message simultaneously.
CREATE OR REPLACE FUNCTION increment_message_read_count(p_message_id UUID)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  UPDATE trip_messages
  SET read_count = read_count + 1
  WHERE id = p_message_id;
$$;

-- Atomically increments discount_codes.use_count for a given code.
-- Called after a successful redemption is recorded so the counter stays
-- accurate even under concurrent redemptions.
CREATE OR REPLACE FUNCTION increment_discount_code_use_count(p_code_id UUID)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  UPDATE discount_codes
  SET use_count = use_count + 1
  WHERE id = p_code_id;
$$;
