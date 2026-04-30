/**
 * Supabase Edge Function — delete-account
 *
 * Deletes the calling user's Rally account end-to-end.
 *
 *   POST /delete-account
 *   Authorization: Bearer <user JWT>
 *
 * Two phases:
 *   1. Call the `delete_account_data` RPC under the caller's JWT so
 *      auth.uid() identifies them. The RPC clears all public-schema
 *      data that won't auto-cascade when auth.users is deleted (trip
 *      sessions, expense_splits with check constraints, cross-user
 *      references to the public.users row).
 *   2. Use the service-role admin API to delete auth.users itself —
 *      that cascades through profiles → trips → polls/respondents/etc.
 *
 * Returns:
 *   200 { ok: true }
 *   200 { ok: false, reason }
 *   401 unauthenticated
 *   500 server_error
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getAdmin } from '../_sms-shared/supabase.ts';
import { getPublishableKey } from '../_sms-shared/api-keys.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, reason: 'method_not_allowed' }, 405);
  }

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    if (!token) {
      return jsonResponse({ ok: false, reason: 'missing_auth' }, 401);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const anonKey     = getPublishableKey();
    if (!supabaseUrl || !anonKey) {
      console.error('[delete-account] missing SUPABASE_URL / publishable key');
      return jsonResponse({ ok: false, reason: 'server_misconfigured' }, 500);
    }

    // Resolve caller via their JWT so the RPC's auth.uid() matches.
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return jsonResponse({ ok: false, reason: 'invalid_auth' }, 401);
    }
    const authUserId = userData.user.id;

    // Phase 1: clear public-schema data that won't auto-cascade.
    const { data: rpcResult, error: rpcErr } = await userClient.rpc('delete_account_data');
    if (rpcErr) {
      console.error('[delete-account] RPC failed:', rpcErr.message);
      return jsonResponse({ ok: false, reason: 'cleanup_failed', detail: rpcErr.message }, 500);
    }
    const rpc = rpcResult as { ok: boolean; reason?: string } | null;
    if (!rpc || rpc.ok !== true) {
      return jsonResponse({ ok: false, reason: rpc?.reason ?? 'cleanup_failed' }, 500);
    }

    // Phase 2: delete the auth user. Cascades to profiles → trips →
    // polls/respondents/members/expenses/etc.
    const admin = getAdmin();
    const { error: delErr } = await admin.auth.admin.deleteUser(authUserId);
    if (delErr) {
      console.error('[delete-account] auth delete failed:', delErr.message);
      return jsonResponse({ ok: false, reason: 'auth_delete_failed', detail: delErr.message }, 500);
    }

    return jsonResponse({ ok: true }, 200);
  } catch (err) {
    console.error('[delete-account] unhandled:', err);
    return jsonResponse({ ok: false, reason: 'server_error' }, 500);
  }
});

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
