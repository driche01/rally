-- ============================================================
-- Migration 129: Phase B — lodging room assignments
--
-- One row per (lodging_option, respondent, room_label). Tracks
-- who's in which room, how many nights, what they owe (cents to
-- preserve precision), and payment status.
--
-- Phase B has no native payment rail — payment_status is informational,
-- the planner links out to Splitwise for actual settlement.
-- ============================================================

CREATE TABLE IF NOT EXISTS lodging_room_assignments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lodging_option_id  uuid NOT NULL REFERENCES lodging_options(id) ON DELETE CASCADE,
  respondent_id      uuid NOT NULL REFERENCES respondents(id) ON DELETE CASCADE,
  room_label         text NOT NULL,
  nights             integer NOT NULL DEFAULT 0,
  cost_owed_cents    integer NOT NULL DEFAULT 0,
  payment_status     text NOT NULL DEFAULT 'unpaid',
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lodging_room_assignments_payment_status_check
    CHECK (payment_status IN ('unpaid','pending','paid')),
  CONSTRAINT lodging_room_assignments_nights_nonneg
    CHECK (nights >= 0),
  CONSTRAINT lodging_room_assignments_cost_nonneg
    CHECK (cost_owed_cents >= 0),
  UNIQUE (lodging_option_id, respondent_id, room_label)
);

CREATE INDEX IF NOT EXISTS idx_lodging_room_assignments_respondent
  ON lodging_room_assignments (respondent_id);

ALTER TABLE lodging_room_assignments ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='lodging_room_assignments' AND policyname='lra_public_select') THEN
    CREATE POLICY lra_public_select ON lodging_room_assignments FOR SELECT
      USING (EXISTS (
        SELECT 1 FROM lodging_options o WHERE o.id = lodging_room_assignments.lodging_option_id
      ));
  END IF;
END$$;

INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES ('129', 'phase_b_lodging_room_assignments', ARRAY[]::text[])
ON CONFLICT (version) DO NOTHING;
