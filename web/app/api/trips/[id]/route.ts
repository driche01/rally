/**
 * /api/trips/[id]
 *   GET   — read a trip. Anon allowed via ?token=<share_token> for
 *           the invitation page. Authed planner/cohost reads also
 *           work via RLS.
 *   PATCH — planner/cohost edits trip metadata.
 */

import { requireAuthUid } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { jsonErr, jsonOk } from "@/lib/http";
import type { Trip, TripTheme } from "@shared/types";

const ALLOWED_THEMES: ReadonlySet<TripTheme> = new Set([
  "classic","eclectic","fancy","literary","digital","elegant",
]);

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const token = url.searchParams.get("token");

  const supabase = await createClient();
  const q = supabase.from("trips").select("*").eq("id", id);

  // Anon callers must supply the share token. RLS allows the read
  // either way; the token check is a defense-in-depth on top.
  const { data, error } = await (token
    ? q.eq("share_token", token).maybeSingle()
    : q.maybeSingle());

  if (error) return jsonErr(500, "trip_read_failed", error.message);
  if (!data)  return jsonErr(404, "trip_not_found");
  return jsonOk(data as Trip);
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const r = await requireAuthUid();
  if (!r.ok) return jsonErr(r.status, "unauthenticated");
  const { id } = await ctx.params;

  const body = await safeJson(req);
  if (!body) return jsonErr(400, "invalid_json");

  const patch: Record<string, unknown> = {};
  if ("name"            in body) patch.name            = strOrNull(body.name);
  if ("destination"     in body) patch.destination     = strOrNull(body.destination);
  if ("description"     in body) patch.description     = strOrNull(body.description);
  if ("cover_image_url" in body) patch.cover_image_url = strOrNull(body.cover_image_url);
  if ("start_date"      in body) patch.start_date      = strOrNull(body.start_date);
  if ("end_date"        in body) patch.end_date        = strOrNull(body.end_date);
  if ("book_by_date"    in body) patch.book_by_date    = strOrNull(body.book_by_date);
  if ("is_public"       in body) patch.is_public       = Boolean(body.is_public);
  if ("budget_min"      in body) patch.budget_min      = numOrNull(body.budget_min);
  if ("budget_max"      in body) patch.budget_max      = numOrNull(body.budget_max);
  if ("group_size_bucket" in body) {
    const bucket = strOrNull(body.group_size_bucket);
    if (bucket && !["0-4","5-8","9-12","13-20","20+"].includes(bucket)) {
      return jsonErr(400, "invalid_group_size_bucket");
    }
    patch.group_size_bucket = bucket ?? "5-8";
  }
  if ("group_size_precise" in body) {
    if (body.group_size_precise == null || body.group_size_precise === "") {
      patch.group_size_precise = null;
    } else {
      const n = Number(body.group_size_precise);
      if (!Number.isFinite(n) || n < 1 || n > 500) {
        return jsonErr(400, "invalid_group_size_precise");
      }
      patch.group_size_precise = Math.floor(n);
    }
  }
  if ("theme"           in body) {
    const t = strOrNull(body.theme) as TripTheme | null;
    if (t && !ALLOWED_THEMES.has(t)) return jsonErr(400, "invalid_theme");
    patch.theme = t;
  }

  // Date-coherence validation.
  if (patch.start_date && patch.end_date && (patch.start_date as string) > (patch.end_date as string)) {
    return jsonErr(400, "end_before_start");
  }
  if (patch.book_by_date && patch.start_date && (patch.book_by_date as string) > (patch.start_date as string)) {
    return jsonErr(400, "book_by_after_start");
  }

  if (Object.keys(patch).length === 0) return jsonErr(400, "no_fields_to_update");
  patch.updated_at = new Date().toISOString();

  const { data, error } = await r.supabase
    .from("trips")
    .update(patch)
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (error) return jsonErr(500, "trip_update_failed", error.message);
  if (!data)  return jsonErr(404, "trip_not_found");
  return jsonOk(data as Trip);
}

function strOrNull(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length === 0 ? null : t;
}
function numOrNull(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && !isNaN(Number(v))) return Number(v);
  return null;
}
async function safeJson(req: Request): Promise<Record<string, unknown> | null> {
  try { return (await req.json()) as Record<string, unknown>; }
  catch { return null; }
}
