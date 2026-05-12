/**
 * POST /api/invite/[token]/comment
 *
 * Anon-friendly comment endpoint for the invitation page. The
 * share token is the gate; we don't require the caller to be on
 * the trip (anyone with the link can drop a comment, mirroring
 * Partiful).
 *
 * Phase A scope: text comments only. GIFs deferred (see
 * BUILD_QUESTIONS Q10).
 *
 * Body: { name: string, phone?: string, text: string }
 *
 * Service-role insert because the activity_feed_entries RLS
 * requires auth.uid() to insert. The share-token-in-URL is the
 * Phase A auth gate.
 */

import { createClient, createServiceClient } from "@/lib/supabase/server";
import { normalizePhone } from "@/lib/phone";
import { jsonErr, jsonOk } from "@/lib/http";
import type { ActivityFeedEntry } from "@shared/types";

const MAX_TEXT = 500;
const MAX_NAME = 30;

export async function POST(
  req: Request,
  ctx: { params: Promise<{ token: string }> },
) {
  const { token } = await ctx.params;
  const body = await safeJson(req);
  if (!body) return jsonErr(400, "invalid_json");

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const text = typeof body.text === "string" ? body.text.trim() : "";
  const rawPhone = typeof body.phone === "string" ? body.phone.trim() : "";
  const phone = rawPhone ? normalizePhone(rawPhone) : null;

  if (!name)               return jsonErr(400, "name_required");
  if (name.length > MAX_NAME) return jsonErr(400, "name_too_long");
  if (!text)               return jsonErr(400, "text_required");
  if (text.length > MAX_TEXT) return jsonErr(400, "text_too_long");

  // Validate trip via share token.
  const anon = await createClient();
  const { data: trip } = await anon
    .from("trips")
    .select("id")
    .eq("share_token", token)
    .maybeSingle();
  if (!trip) return jsonErr(404, "trip_not_found");

  // Optional: link to users.id if a phone was provided + matches.
  const svc = createServiceClient();
  let user_id: string | null = null;
  if (phone) {
    const { data: u } = await svc
      .from("users")
      .select("id")
      .eq("phone", phone)
      .maybeSingle();
    user_id = u?.id ?? null;
  }

  const { data, error } = await svc
    .from("activity_feed_entries")
    .insert({
      trip_id: trip.id,
      user_id,
      entry_type: "comment",
      content: { name, text },
    })
    .select("*")
    .single();
  if (error) return jsonErr(500, "comment_insert_failed", error.message);

  return jsonOk(data as ActivityFeedEntry);
}

async function safeJson(req: Request): Promise<Record<string, unknown> | null> {
  try { return (await req.json()) as Record<string, unknown>; }
  catch { return null; }
}
