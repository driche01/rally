/**
 * GET /api/account/whoami
 *
 * Lightweight identity probe used by client components that need to
 * decide between "full UX" and "anon fallback". Returns 200 + a
 * minimal identity payload when the caller has either:
 *   • a Supabase auth session (planner / cohost / authed respondent), or
 *   • a rally_session_token cookie that resolves to a respondent row.
 *
 * Returns 401 otherwise.
 *
 * Intentionally minimal — no PII, just enough for the client to
 * gate UI affordances (reactions, threading, media upload).
 */

import { cookies } from "next/headers";
import { requireAuthUid } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { jsonErr, jsonOk } from "@/lib/http";

export async function GET() {
  const authResult = await requireAuthUid();
  if (authResult.ok) {
    return jsonOk({ source: "auth", auth_uid: authResult.authUid });
  }

  const cookieStore = await cookies();
  const sessionToken = cookieStore.get("rally_session_token")?.value ?? null;
  if (sessionToken) {
    const svc = createServiceClient();
    const { data: r } = await svc
      .from("respondents")
      .select("user_id")
      .eq("session_token", sessionToken)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (r) return jsonOk({ source: "session", users_id: r.user_id ?? null });
  }

  return jsonErr(401, "unauthenticated");
}
