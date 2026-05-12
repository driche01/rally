-- ============================================================
-- Migration 127: Phase B — yes/no/maybe voting on lodging options
--
-- Per BUILD_QUESTIONS.md Q12 (RESOLVED): extend additively. The
-- existing model is presence-only (a row means "this respondent
-- voted yes"); default 'yes' preserves that semantic for any
-- existing rows (verified 0 live rows pre-migration).
-- ============================================================

ALTER TABLE lodging_votes
  ADD COLUMN IF NOT EXISTS vote text NOT NULL DEFAULT 'yes';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'lodging_votes_vote_check'
  ) THEN
    ALTER TABLE lodging_votes
      ADD CONSTRAINT lodging_votes_vote_check
      CHECK (vote IN ('yes', 'no', 'maybe'));
  END IF;
END$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_lodging_votes_unique
  ON lodging_votes (lodging_option_id, respondent_id);

INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES ('127', 'phase_b_lodging_votes_extend', ARRAY[]::text[])
ON CONFLICT (version) DO NOTHING;
