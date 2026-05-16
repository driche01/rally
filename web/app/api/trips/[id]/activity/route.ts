/**
 * /api/trips/[id]/activity
 *   GET  — read activity feed (anon-allowed under share-token policy)
 *   POST — post a comment / gif / photo / planner_post / threaded reply.
 *          Accepts either:
 *            • A real Supabase auth session (planner / cohost / authed
 *              respondent) — user_id resolved via users.auth_user_id.
 *            • A rally_session_token cookie (respondent who's RSVPed
 *              but never gone through OTP) — user_id resolved via
 *              respondents.session_token → respondents.user_id.
 *          Soft-auth path means a respondent's post carries their
 *          identity automatically — no name re-entry (backlog #11).
 *
 * Distinct from trip_audit_events (planner-only audit log).
 */

import { cookies } from "next/headers";
import { requireAuthUid } from "@/lib/auth";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { jsonErr, jsonOk } from "@/lib/http";
import { assertTripWritable } from "@/lib/trip-state";
import type { ActivityFeedEntry, ActivityEntryType } from "@shared/types";

const POSTABLE_TYPES: ReadonlySet<ActivityEntryType> = new Set([
  "comment", "gif", "photo", "planner_post",
]);

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: trip_id } = await ctx.params;
  const url = new URL(req.url);
  const limit = clampInt(url.searchParams.get("limit"), 100, 1, 500);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("activity_feed_entries")
    .select("*")
    .eq("trip_id", trip_id)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) return jsonErr(500, "feed_read_failed", error.message);
  return jsonOk((data ?? []) as ActivityFeedEntry[]);
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: trip_id } = await ctx.params;

  const body = await safeJson(req);
  if (!body) return jsonErr(400, "invalid_json");

  const entry_type = body.entry_type as ActivityEntryType | undefined;
  if (!entry_type || !POSTABLE_TYPES.has(entry_type)) {
    return jsonErr(400, "invalid_entry_type");
  }

  const content =
    body.content && typeof body.content === "object"
      ? (body.content as Record<string, unknown>)
      : null;
  if (!content) return jsonErr(400, "content_required");

  const parent_id =
    typeof body.parent_id === "string" && body.parent_id.length > 0
      ? body.parent_id
      : null;

  // Phase C: writes to cancelled trips return 410.
  const svc = createServiceClient();
  const writability = await assertTripWritable(svc, trip_id);
  if (!writability.ok) return jsonErr(writability.status, writability.code, writability.detail);

  // Validate parent (if supplied) belongs to this trip.
  if (parent_id) {
    const { data: parent } = await svc
      .from("activity_feed_entries")
      .select("trip_id")
      .eq("id", parent_id)
      .maybeSingle();
    if (!parent || parent.trip_id !== trip_id) {
      return jsonErr(400, "invalid_parent");
    }
  }

  // Identify the poster — try Supabase auth first, fall back to the
  // rally_session_token cookie set by /api/invite/[token]/rsvp.
  let userId: string | null = null;

  const authResult = await requireAuthUid();
  if (authResult.ok) {
    const { data: rallyUser } = await authResult.supabase
      .from("users")
      .select("id")
      .eq("auth_user_id", authResult.authUid)
      .maybeSingle();
    userId = rallyUser?.id ?? null;
  } else {
    // Soft auth: cookie-only respondent. The post is attributed to
    // their users row via the session_token → respondents → user_id
    // chain (already linked at RSVP time).
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get("rally_session_token")?.value ?? null;
    if (sessionToken) {
      const { data: r } = await svc
        .from("respondents")
        .select("user_id, trip_id")
        .eq("session_token", sessionToken)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      // The cookie identifies the visitor; we accept posts on any trip
      // they share a respondent row on (matches the public-feed
      // surface). The respondent doesn't have to be on THIS trip — a
      // visitor may comment on trips they've been invited to via a
      // link they were forwarded.
      if (r) userId = r.user_id;
    }
  }

  // 401 only if we have nothing — anon visitors without any signal
  // are blocked.
  if (!userId && !authResult.ok) {
    return jsonErr(401, "unauthenticated");
  }

  // Service-role insert to bypass the RLS write policy (which only
  // permits an authed user_id-match). We've already established
  // identity above and stamped user_id correctly.
  const { data, error } = await svc
    .from("activity_feed_entries")
    .insert({
      trip_id,
      user_id: userId,
      entry_type,
      content,
      parent_id,
    })
    .select("*")
    .single();

  if (error) return jsonErr(500, "feed_post_failed", error.message);
  return jsonOk(data as ActivityFeedEntry);
}

function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}
async function safeJson(req: Request): Promise<Record<string, unknown> | null> {
  try { return (await req.json()) as Record<string, unknown>; }
  catch { return null; }
}
