import { supabase } from '../supabase';
import type { Profile } from '../../types/database';

/** Fetch any profile by user ID (requires the caller to be a trip member of that user's trip). */
export async function getProfileById(userId: string): Promise<Profile | null> {
  const { data } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();
  return data ?? null;
}

/** Fetch the currently authenticated user's own profile. */
export async function getMyProfile(): Promise<Profile | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();
  return data ?? null;
}

// ─── Avatar upload/remove ────────────────────────────────────────────────────
//
// Files live under `<user_id>/<timestamp>.<ext>` in the public `avatars`
// bucket. The user-id folder prefix is what the storage RLS policy keys
// off — see migration 098_user_avatars.sql.

const AVATAR_BUCKET = 'avatars';

/**
 * Upload a new avatar from a local file URI (returned by expo-image-picker).
 * Replaces any existing avatar by overwriting under the user's folder, then
 * writes the resulting public URL to `profiles.avatar_url`. Returns the URL
 * so the caller can update its cache without a refetch.
 */
export async function uploadMyAvatar(localUri: string): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');

  // Read the file into bytes. fetch+blob works for both file:// (native) and
  // data:/blob: URLs (web), and is the supabase-js-recommended pattern.
  const res = await fetch(localUri);
  const blob = await res.blob();
  const contentType = blob.type || 'image/jpeg';
  const ext = contentType.split('/')[1]?.split(';')[0] || 'jpg';

  // Timestamped filename so the public URL changes on each upload — sidesteps
  // CDN/image caching that would otherwise pin the old picture.
  const path = `${user.id}/${Date.now()}.${ext}`;

  const { error: uploadErr } = await supabase
    .storage
    .from(AVATAR_BUCKET)
    .upload(path, blob, { contentType, upsert: true });
  if (uploadErr) throw uploadErr;

  const { data: { publicUrl } } = supabase
    .storage
    .from(AVATAR_BUCKET)
    .getPublicUrl(path);

  // Best-effort cleanup of any prior avatar files under this user's folder
  // so the bucket doesn't accumulate orphans on each replace.
  try {
    const { data: existing } = await supabase
      .storage
      .from(AVATAR_BUCKET)
      .list(user.id);
    const stale = (existing ?? [])
      .map((f) => `${user.id}/${f.name}`)
      .filter((p) => p !== path);
    if (stale.length > 0) {
      await supabase.storage.from(AVATAR_BUCKET).remove(stale);
    }
  } catch {
    // non-fatal — the new avatar is already live
  }

  const { error: updateErr } = await supabase
    .from('profiles')
    .update({ avatar_url: publicUrl })
    .eq('id', user.id);
  if (updateErr) throw updateErr;

  return publicUrl;
}

/** Clear the user's avatar — empties their storage folder and nulls the column. */
export async function removeMyAvatar(): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');

  // Wipe every file under the user's folder. Listing first lets us pass
  // explicit paths to remove(); the API doesn't have a "delete folder" op.
  const { data: existing } = await supabase
    .storage
    .from(AVATAR_BUCKET)
    .list(user.id);
  const paths = (existing ?? []).map((f) => `${user.id}/${f.name}`);
  if (paths.length > 0) {
    await supabase.storage.from(AVATAR_BUCKET).remove(paths);
  }

  const { error: updateErr } = await supabase
    .from('profiles')
    .update({ avatar_url: null })
    .eq('id', user.id);
  if (updateErr) throw updateErr;
}
