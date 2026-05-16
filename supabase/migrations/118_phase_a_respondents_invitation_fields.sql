-- ============================================================
-- Migration 118: Phase A — invitation/RSVP fields on respondents
--
-- Per BUILD_QUESTIONS.md Q3 (RESOLVED): reuse respondents for
-- invitees. respondents already carries name/phone/email/user_id
-- + the legacy rsvp ('in'/'out') used by the Expo app's day poll.
-- Phase A adds parallel rsvp_status with the {invited, going,
-- maybe, cant_go} lifecycle. Both columns coexist.
--
-- invited_by FKs users(id) per Q1 (invitee/SMS FKs → users).
-- ============================================================

ALTER TABLE respondents
  ADD COLUMN IF NOT EXISTS rsvp_status            text,
  ADD COLUMN IF NOT EXISTS rsvp_status_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS invited_by             uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS invited_at             timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.check_constraints WHERE constraint_name = 'respondents_rsvp_status_check') THEN
    ALTER TABLE respondents ADD CONSTRAINT respondents_rsvp_status_check
      CHECK (rsvp_status IS NULL OR rsvp_status IN ('invited','going','maybe','cant_go'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.check_constraints WHERE constraint_name = 'respondents_identity_required') THEN
    ALTER TABLE respondents ADD CONSTRAINT respondents_identity_required
      CHECK (user_id IS NOT NULL OR phone IS NOT NULL OR email IS NOT NULL);
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_respondents_trip_rsvp_status
  ON respondents (trip_id, rsvp_status);
CREATE INDEX IF NOT EXISTS idx_respondents_invited_at
  ON respondents (invited_at)
  WHERE rsvp_status = 'invited';

INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES ('118', 'phase_a_respondents_invitation_fields', ARRAY[]::text[])
ON CONFLICT (version) DO NOTHING;
