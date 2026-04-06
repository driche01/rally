/**
 * Shared Supabase admin client for SMS agent functions.
 */
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

let _admin: SupabaseClient | null = null;

export function getAdmin(): SupabaseClient {
  if (!_admin) {
    const url = Deno.env.get('SUPABASE_URL') ?? '';
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    _admin = createClient(url, key);
  }
  return _admin;
}
