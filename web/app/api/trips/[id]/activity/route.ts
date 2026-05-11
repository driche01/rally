/**
 * /api/trips/[id]/activity
 *   GET  — read activity feed (anon-allowed under share-token policy)
 *   POST — authed planner/cohost/member posts a comment/gif/photo
 *
 * Distinct from trip_audit_events (planner-only audit log).
 */

import { requireAuthUid } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { jsonErr, jsonOk } from "@/lib/http";
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
  const limit = clampInt(url.searchParams.get("limit"), 50, 1, 200);

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
  const r = await requireAuthUid();
  if (!r.ok) return jsonErr(r.status, "unauthenticated");
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

  // Map auth.uid() → users.id for the FK. activity_feed_entries.user_id
  // FKs users(id) per BUILD_QUESTIONS Q1.
  const { data: rallyUser, error: userErr } = await r.supabase
    .from("users")
    .select("id")
    .eq("auth_user_id", r.authUid)
    .maybeSingle();
  if (userErr) return jsonErr(500, "user_lookup_failed", userErr.message);

  const { data, error } = await r.supabase
    .from("activity_feed_entries")
    .insert({
      trip_id,
      user_id: rallyUser?.id ?? null,
      entry_type,
      content,
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
