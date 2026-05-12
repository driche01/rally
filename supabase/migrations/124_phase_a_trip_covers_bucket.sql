-- ============================================================
-- Migration 124: Phase A — trip-covers storage bucket
--
-- Holds cover images uploaded by planners (Step 3 form) or
-- generated via the Gemini image API. Public-read so invitees
-- can render the cover on the public invitation page without
-- having to be authed.
--
-- Writes go through the /api/uploads/cover and /api/uploads/
-- generate-cover route handlers, which use the service-role
-- key — so no INSERT/UPDATE/DELETE policy is needed for public
-- roles. Reads are gated by a single SELECT policy: bucket_id
-- match, that's it.
-- ============================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('trip-covers', 'trip-covers', true)
ON CONFLICT (id) DO NOTHING;

-- Public read policy (anon + authenticated). The bucket is
-- public; the policy is what makes the read actually work under
-- storage's RLS.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'trip_covers_public_read'
  ) THEN
    CREATE POLICY trip_covers_public_read
      ON storage.objects
      FOR SELECT
      USING (bucket_id = 'trip-covers');
  END IF;
END$$;

INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES ('124', 'phase_a_trip_covers_bucket', ARRAY[]::text[])
ON CONFLICT (version) DO NOTHING;
