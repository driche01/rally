-- ============================================================
-- Migration 035: Beta signups (waitlist)
--
-- Stores emails for the closed-beta waitlist, collected from:
--  - `/download` landing page
--  - `/t/<tripId>` share-link fallback (when someone taps an SMS
--    install CTA but doesn't have the app yet)
--
-- Anonymous users can INSERT. No public SELECT policy — only
-- service-role (admin / edge functions) can read the list.
-- ============================================================

CREATE TABLE IF NOT EXISTS beta_signups (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email      text NOT NULL,
  source     text,                 -- e.g. 'download_page', 'trip_link', 'sms_intro'
  trip_id    uuid REFERENCES trips(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Dedupe on lowercased email — someone signing up twice is a no-op
CREATE UNIQUE INDEX IF NOT EXISTS beta_signups_email_unique
  ON beta_signups (lower(email));

-- Helpful index for the (rare) "which trip drove this signup" queries
CREATE INDEX IF NOT EXISTS beta_signups_trip_id_idx
  ON beta_signups (trip_id) WHERE trip_id IS NOT NULL;

ALTER TABLE beta_signups ENABLE ROW LEVEL SECURITY;

-- Anyone (auth'd or anon) can add themselves to the waitlist
DO $$ BEGIN
  CREATE POLICY "beta_signups_public_insert" ON beta_signups
    FOR INSERT TO anon, authenticated
    WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- NO SELECT policy — keeps the list private (service-role only reads)
