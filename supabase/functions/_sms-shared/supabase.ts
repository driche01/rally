/**
 * Shared Supabase admin client for SMS agent functions.
 */
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getServiceRoleKey } from './api-keys.ts';

let _admin: SupabaseClient | null = null;

export function getAdmin(): SupabaseClient {
  if (!_admin) {
    const url = Deno.env.get('SUPABASE_URL') ?? '';
    const key = getServiceRoleKey();
    _admin = createClient(url, key);
  }
  return _admin;
}

/** Test-only: inject a mock client. */
// deno-lint-ignore no-explicit-any
export function _setAdminForTesting(client: any): void {
  _admin = client as SupabaseClient;
}
