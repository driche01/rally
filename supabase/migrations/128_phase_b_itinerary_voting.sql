-- ============================================================
-- Migration 128: Phase B — itinerary voting + alternatives
--
-- Three tables for the "vote on items, including A-vs-B groupings"
-- pattern from build guide §5 Step 4. All per-member FKs target
-- respondents(id) per Q13.
-- ============================================================

CREATE TABLE IF NOT EXISTS itinerary_item_votes (
  itinerary_block_id uuid NOT NULL REFERENCES itinerary_blocks(id) ON DELETE CASCADE,
  respondent_id      uuid NOT NULL REFERENCES respondents(id) ON DELETE CASCADE,
  vote               text NOT NULL,
  voted_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (itinerary_block_id, respondent_id),
  CONSTRAINT itinerary_item_votes_vote_check CHECK (vote IN ('yes','no','maybe'))
);

CREATE INDEX IF NOT EXISTS idx_itinerary_item_votes_respondent
  ON itinerary_item_votes (respondent_id);

CREATE TABLE IF NOT EXISTS itinerary_item_alternatives (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id           uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  day_date          date NOT NULL,
  slot_label        text NOT NULL,
  winning_block_id  uuid REFERENCES itinerary_blocks(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_itinerary_alternatives_trip_day
  ON itinerary_item_alternatives (trip_id, day_date);

CREATE TABLE IF NOT EXISTS itinerary_alternative_options (
  alternative_id     uuid NOT NULL REFERENCES itinerary_item_alternatives(id) ON DELETE CASCADE,
  itinerary_block_id uuid NOT NULL REFERENCES itinerary_blocks(id) ON DELETE CASCADE,
  PRIMARY KEY (alternative_id, itinerary_block_id)
);

ALTER TABLE itinerary_item_votes          ENABLE ROW LEVEL SECURITY;
ALTER TABLE itinerary_item_alternatives   ENABLE ROW LEVEL SECURITY;
ALTER TABLE itinerary_alternative_options ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='itinerary_item_votes' AND policyname='itinerary_item_votes_public_select') THEN
    CREATE POLICY itinerary_item_votes_public_select
      ON itinerary_item_votes FOR SELECT
      USING (EXISTS (
        SELECT 1 FROM itinerary_blocks b WHERE b.id = itinerary_item_votes.itinerary_block_id
      ));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='itinerary_item_alternatives' AND policyname='alts_public_select') THEN
    CREATE POLICY alts_public_select ON itinerary_item_alternatives FOR SELECT
      USING (EXISTS (SELECT 1 FROM trips t WHERE t.id = itinerary_item_alternatives.trip_id));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='itinerary_alternative_options' AND policyname='alt_opts_public_select') THEN
    CREATE POLICY alt_opts_public_select ON itinerary_alternative_options FOR SELECT
      USING (EXISTS (
        SELECT 1 FROM itinerary_item_alternatives a
        WHERE a.id = itinerary_alternative_options.alternative_id
      ));
  END IF;
END$$;

INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES ('128', 'phase_b_itinerary_voting', ARRAY[]::text[])
ON CONFLICT (version) DO NOTHING;
