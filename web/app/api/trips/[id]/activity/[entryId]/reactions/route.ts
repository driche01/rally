/**
 * /api/trips/[id]/activity/[entryId]/reactions
 *   POST   — toggle a reaction (add if missing, remove if present).
 *            Idempotent on the same emoji.
 *
 * Same dual-auth posture as the parent activity POST: Supabase auth
 * if present, falls back to the rally_session_token cookie so a
 * respondent who's RSVPed but hasn't gone through OTP can still
 * react without re-signing in.
 *
 * Body: { emoji: string }  (1–16 chars, validated client-side too)
 *
 * Returns: { added: true } | { removed: true } so the client can
 * apply an optimistic toggle.
 */

import { cookies } from "next/headers";
import { requireAuthUid } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { jsonErr, jsonOk } from "@/lib/http";
import { assertTripWritable } from "@/lib/trip-state";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string; entryId: string }> },
) {
  const { id: trip_id, entryId } = await ctx.params;

  const body = await safeJson(req);
  if (!body) return jsonErr(400, "invalid_json");

  const emoji = (typeof body.emoji === "string" ? body.emoji : "").trim();
  if (!emoji) return jsonErr(400, "emoji_required");
  if (emoji.length > 16) return jsonErr(400, "emoji_too_long");

  const svc = createServiceClient();

  // The entry must belong to this trip — defensive check that also
  // rejects orphaned IDs.
  const { data: entry } = await svc
    .from("activity_feed_entries")
    .select("trip_id")
    .eq("id", entryId)
    .maybeSingle();
  if (!entry || entry.trip_id !== trip_id) {
    return jsonErr(404, "entry_not_found");
  }

  const writability = await assertTripWritable(svc, trip_id);
  if (!writability.ok) return jsonErr(writability.status, writability.code, writability.detail);

  // Resolve the reacting user (same dual-auth as activity POST).
  let userId: string | null = null;
  const authResult = await requireAuthUid();
  if (authResult.ok) {
    const { data: rallyUser } = await authResult.supabase
      .from("users").select("id").eq("auth_user_id", authResult.authUid).maybeSingle();
    userId = rallyUser?.id ?? null;
  }
  if (!userId) {
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get("rally_session_token")?.value ?? null;
    if (sessionToken) {
      const { data: r } = await svc
        .from("respondents")
        .select("user_id")
        .eq("session_token", sessionToken)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      userId = r?.user_id ?? null;
    }
  }
  if (!userId) return jsonErr(401, "unauthenticated");

  // Toggle. We can't rely on a single UPSERT here because we want to
  // know whether the row already existed (so the client can update
  // counts optimistically). Two-step: look up, then insert or delete.
  const { data: existing } = await svc
    .from("activity_reactions")
    .select("id")
    .eq("entry_id", entryId)
    .eq("user_id", userId)
    .eq("emoji", emoji)
    .maybeSingle();

  if (existing) {
    const { error: delErr } = await svc
      .from("activity_reactions").delete().eq("id", existing.id);
    if (delErr) return jsonErr(500, "reaction_delete_failed", delErr.message);
    return jsonOk({ removed: true });
  }

  const { error: insErr } = await svc
    .from("activity_reactions")
    .insert({ entry_id: entryId, user_id: userId, emoji });
  if (insErr) return jsonErr(500, "reaction_insert_failed", insErr.message);
  return jsonOk({ added: true });
}

async function safeJson(req: Request): Promise<Record<string, unknown> | null> {
  try { return (await req.json()) as Record<string, unknown>; }
  catch { return null; }
}
