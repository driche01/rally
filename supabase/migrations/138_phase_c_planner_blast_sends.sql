-- ============================================================
-- Migration 138: Phase C — planner_blast_sends
--
-- One row per recipient per blast. Tracks delivery state and
-- links back to the thread_messages send-log row.
--
--   blast_id                   → planner_blasts(id) (CASCADE)
--   recipient_respondent_id    → respondents(id) (Q18)
--   thread_message_id          → thread_messages(id) (Q19)
--
-- delivery_status mirrors the thread_messages.delivery_status
-- values the existing dm-sender.ts rail writes.
-- ============================================================

CREATE TABLE IF NOT EXISTS planner_blast_sends (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  blast_id                 uuid NOT NULL REFERENCES planner_blasts(id) ON DELETE CASCADE,
  recipient_respondent_id  uuid NOT NULL REFERENCES respondents(id) ON DELETE CASCADE,
  thread_message_id        uuid NULL REFERENCES thread_messages(id),
  delivery_status          text NULL,
  error_code               text NULL,
  sent_at                  timestamptz NULL,
  created_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_planner_blast_sends_blast
  ON planner_blast_sends (blast_id);

CREATE INDEX IF NOT EXISTS idx_planner_blast_sends_recipient
  ON planner_blast_sends (recipient_respondent_id);

-- Dedupe: never send the same blast to the same recipient twice.
CREATE UNIQUE INDEX IF NOT EXISTS idx_planner_blast_sends_unique
  ON planner_blast_sends (blast_id, recipient_respondent_id);

ALTER TABLE planner_blast_sends ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='planner_blast_sends' AND policyname='blast_sends_host_select') THEN
    CREATE POLICY blast_sends_host_select ON planner_blast_sends FOR SELECT
      USING (
        EXISTS (
          SELECT 1
          FROM planner_blasts b
          JOIN trips t ON t.id = b.trip_id
          WHERE b.id = planner_blast_sends.blast_id
            AND (
              t.created_by = auth.uid()
              OR EXISTS (SELECT 1 FROM trip_cohosts c WHERE c.trip_id = t.id AND c.user_id = auth.uid())
            )
        )
      );
  END IF;
END$$;

-- No app-layer INSERT/UPDATE policy: writes go through the
-- service-role send pipeline (sms-trip-blast edge function).

INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES ('138', 'phase_c_planner_blast_sends', ARRAY[]::text[])
ON CONFLICT (version) DO NOTHING;
