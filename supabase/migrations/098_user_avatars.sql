-- ─── PROFILE AVATARS ────────────────────────────────────────────────────────
--
-- Adds an `avatar_url` column to `profiles` and a public `avatars` storage
-- bucket so users can upload a headshot from the Account screen. Files are
-- stored under <user_id>/<filename> so RLS can scope writes per-owner via
-- the leading folder name. Reads are public so the URL can be served to
-- group members who view a participant's profile without an extra signed
-- URL round-trip.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS avatar_url text;

-- Bucket — public read so we can render avatars by URL. Per-user write
-- access is scoped below via the storage.objects policies.
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Public read.
DROP POLICY IF EXISTS "Avatar images are publicly readable" ON storage.objects;
CREATE POLICY "Avatar images are publicly readable"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'avatars');

-- Owner-scoped write — user can only touch files under their own user-id
-- folder. `storage.foldername(name)` parses the path; the first segment is
-- the user id we set client-side at upload time.
DROP POLICY IF EXISTS "Users can upload their own avatar" ON storage.objects;
CREATE POLICY "Users can upload their own avatar"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Users can update their own avatar" ON storage.objects;
CREATE POLICY "Users can update their own avatar"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Users can delete their own avatar" ON storage.objects;
CREATE POLICY "Users can delete their own avatar"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
