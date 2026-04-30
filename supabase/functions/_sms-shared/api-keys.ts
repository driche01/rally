/**
 * Edge-function helpers for resolving Supabase API keys.
 *
 * Background — May 2025, Supabase migrated from legacy JWT-based API keys
 * (`anon` / `service_role`, signed by the project's JWT secret) to opaque
 * `sb_publishable_*` / `sb_secret_*` keys exposed via two new built-in
 * env vars:
 *
 *   SUPABASE_PUBLISHABLE_KEYS  — JSON dictionary of publishable keys
 *   SUPABASE_SECRET_KEYS       — JSON dictionary of secret keys
 *
 * The legacy env vars (SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY) still
 * exist and Supabase keeps them populated with the rotated JWT values, but
 * they're flagged DEPRECATED in the dashboard.
 *
 * These helpers prefer the new dict-shaped env vars and silently fall back
 * to the legacy ones — so:
 *  - if Supabase changes the dict shape, we still work via fallback
 *  - if Supabase eventually removes the legacy vars, we still work via the
 *    new ones
 *  - dev / preview environments without the new vars set still work
 *
 * Format assumed: `{ "<key_name>": "<sb_xxx_value>" }`. We pick the first
 * non-empty string value — adequate for projects with a single secret /
 * publishable key, which is the normal case.
 */

/** First non-empty string value in a parsed JSON dict, or null. */
function firstValue(json: string): string | null {
  try {
    const dict = JSON.parse(json) as Record<string, unknown>;
    for (const v of Object.values(dict)) {
      if (typeof v === 'string' && v.length > 0) return v;
    }
  } catch {
    /* malformed — caller falls back */
  }
  return null;
}

/**
 * Returns the active service-role / secret key. Throws if neither the
 * new nor legacy env var resolves to a usable value.
 */
export function getServiceRoleKey(): string {
  const newJson = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (newJson) {
    const v = firstValue(newJson);
    if (v) return v;
  }
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (legacy) return legacy;
  throw new Error('No Supabase service-role key configured (checked SUPABASE_SECRET_KEYS, SUPABASE_SERVICE_ROLE_KEY)');
}

/**
 * Returns the active anon / publishable key. Throws if neither resolves.
 */
export function getPublishableKey(): string {
  const newJson = Deno.env.get('SUPABASE_PUBLISHABLE_KEYS');
  if (newJson) {
    const v = firstValue(newJson);
    if (v) return v;
  }
  const legacy = Deno.env.get('SUPABASE_ANON_KEY');
  if (legacy) return legacy;
  throw new Error('No Supabase publishable key configured (checked SUPABASE_PUBLISHABLE_KEYS, SUPABASE_ANON_KEY)');
}
