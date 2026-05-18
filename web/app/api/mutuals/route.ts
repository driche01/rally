/**
 * /api/mutuals
 *   GET — fetch the caller's mutuals list (past trip-mates), sorted
 *         by shared_trip_count desc. Each row is enriched with a
 *         display name + phone joined from the users table (with a
 *         respondents.name fallback for users that never set
 *         display_name).
 *
 * The mutuals job that populates the underlying table runs separately
 * (Step 10 of build guide §6). Until then, this route returns whatever
 * the job has written so far — which may be an empty array.
 *
 * The invite-modal "past trip-mates" list calls this endpoint and
 * relies on the enriched `name` + `phone` fields to render a real
 * row and offer one-tap "+ Add" into the recipients list.
 */

import { requireRallyUserId } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { jsonErr, jsonOk } from "@/lib/http";
import type { Mutual } from "@shared/types";

export async function GET() {
  const r = await requireRallyUserId();
  if (!r.ok) return jsonErr(r.status, r.status === 404 ? "rally_user_not_found" : "unauthenticated");

  const { data, error } = await r.supabase
    .from("mutuals")
    .select("*")
    .eq("user_id", r.rallyUserId)
    .order("shared_trip_count", { ascending: false })
    .limit(50);

  if (error) return jsonErr(500, "mutuals_read_failed", error.message);
  const rows = (data ?? []) as Mutual[];
  if (rows.length === 0) return jsonOk(rows);

  // Resolve names + phones. Two-step lookup matches the /user/[id]
  // page pattern: prefer users.display_name; fall back to the most-
  // recent respondents.name. Service client because the RLS policy on
  // users restricts caller-side reads to the caller's own row.
  const svc = createServiceClient();
  const ids = rows.map((m) => m.mutual_user_id);

  const { data: userRows } = await svc
    .from("users")
    .select("id, display_name, phone")
    .in("id", ids);
  const userMap = new Map<string, { name: string | null; phone: string | null }>(
    (userRows ?? []).map((u) => [
      u.id as string,
      {
        name:  (u.display_name as string | null) ?? null,
        phone: (u.phone as string | null) ?? null,
      },
    ]),
  );

  // For ids that still have no name, pull the freshest respondents.name.
  // Phones aren't on respondents (well — they are, but the users.phone
  // is canonical so we don't override).
  const missingName = ids.filter((id) => !userMap.get(id)?.name);
  if (missingName.length > 0) {
    const { data: respRows } = await svc
      .from("respondents")
      .select("user_id, name, created_at")
      .in("user_id", missingName)
      .order("created_at", { ascending: false });
    for (const id of missingName) {
      const match = (respRows ?? []).find((row) => row.user_id === id);
      if (match) {
        const cur = userMap.get(id) ?? { name: null, phone: null };
        userMap.set(id, { ...cur, name: (match.name as string) ?? null });
      }
    }
  }

  const enriched: Mutual[] = rows.map((m) => {
    const u = userMap.get(m.mutual_user_id);
    return {
      ...m,
      name:  u?.name  ?? null,
      phone: u?.phone ?? null,
    };
  });

  return jsonOk(enriched);
}
