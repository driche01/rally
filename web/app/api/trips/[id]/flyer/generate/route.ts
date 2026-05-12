/**
 * POST /api/trips/[id]/flyer/generate
 *
 * Authed planner/cohost generates an Instagram-ready flyer for the
 * trip. Body: { format?: 'story' | 'post' | 'both' } (default 'both').
 *
 * For each requested format, renders the template via /web/lib/flyer/
 * render.tsx, uploads the PNG to trip-covers bucket under flyers/<...>,
 * inserts a trip_flyers row, and writes a generation-log entry.
 *
 * Response: { flyers: { format, url, id }[] }.
 */

import { requireAuthUid } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { jsonErr, jsonOk } from "@/lib/http";
import { renderFlyer, type FlyerFormat } from "@/lib/flyer/render";
import type { Trip } from "@shared/types";
import { randomBytes } from "node:crypto";

const TEMPLATE_ID = "theme-aware-v1";
const ALL_FORMATS: FlyerFormat[] = ["story", "post"];

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const r = await requireAuthUid();
  if (!r.ok) return jsonErr(r.status, "unauthenticated");
  const { id: trip_id } = await ctx.params;

  const body = (await req.json().catch(() => ({}))) as { format?: string };
  const requested: FlyerFormat[] =
    body.format === "story" ? ["story"] :
    body.format === "post"  ? ["post"]  :
    ALL_FORMATS;

  // Authorize: planner or cohost.
  const { data: trip, error: tripErr } = await r.supabase
    .from("trips")
    .select("id, name, destination, start_date, end_date, theme, cover_image_url, share_token, created_by")
    .eq("id", trip_id)
    .maybeSingle();
  if (tripErr) return jsonErr(500, "trip_read_failed", tripErr.message);
  if (!trip)   return jsonErr(404, "trip_not_found");

  const isPlanner = trip.created_by === r.authUid;
  if (!isPlanner) {
    const { data: cohost } = await r.supabase
      .from("trip_cohosts")
      .select("trip_id")
      .eq("trip_id", trip_id)
      .eq("user_id", r.authUid)
      .maybeSingle();
    if (!cohost) return jsonErr(403, "forbidden");
  }

  // Planner display name for the "Hosted by" line.
  const svc = createServiceClient();
  const { data: planner } = await svc
    .from("profiles")
    .select("name, last_name")
    .eq("id", trip.created_by)
    .maybeSingle();
  const plannerName = planner
    ? (planner.last_name ? `${planner.name} ${planner.last_name}` : planner.name)
    : "A friend";

  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const inviteUrl = `${baseUrl}/invite/${trip.share_token}`;

  const out: { format: FlyerFormat; url: string; id: string }[] = [];

  for (const format of requested) {
    const t0 = Date.now();
    let bytes: Uint8Array;
    try {
      bytes = await renderFlyer({
        trip: trip as Pick<Trip, "name" | "destination" | "start_date" | "end_date" | "theme" | "cover_image_url" | "share_token">,
        plannerName,
        inviteUrl,
        format,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "render_failed";
      await logGeneration(svc, trip_id, r.authUid, "flyer_render", "self", TEMPLATE_ID, Date.now() - t0, msg);
      return jsonErr(500, "flyer_render_failed", msg);
    }

    const path = `flyers/${r.authUid}/${Date.now()}-${randomBytes(4).toString("hex")}-${format}.png`;
    const { error: upErr } = await svc.storage
      .from("trip-covers")
      .upload(path, bytes, { contentType: "image/png", upsert: false });
    if (upErr) {
      await logGeneration(svc, trip_id, r.authUid, "flyer_render", "self", TEMPLATE_ID, Date.now() - t0, upErr.message);
      return jsonErr(500, "flyer_upload_failed", upErr.message);
    }
    const { data: pub } = svc.storage.from("trip-covers").getPublicUrl(path);

    const { data: inserted, error: insErr } = await svc
      .from("trip_flyers")
      .insert({
        trip_id,
        template_id: TEMPLATE_ID,
        cover_image_url: trip.cover_image_url,
        rendered_image_url: pub.publicUrl,
        format,
        generated_by: r.authUid,
      })
      .select("id, rendered_image_url, format")
      .single();
    if (insErr) {
      await logGeneration(svc, trip_id, r.authUid, "flyer_render", "self", TEMPLATE_ID, Date.now() - t0, insErr.message);
      return jsonErr(500, "flyer_record_failed", insErr.message);
    }

    await logGeneration(svc, trip_id, r.authUid, "flyer_render", "self", TEMPLATE_ID, Date.now() - t0, null);
    out.push({ format: inserted.format as FlyerFormat, url: inserted.rendered_image_url, id: inserted.id });
  }

  return jsonOk({ flyers: out });
}

async function logGeneration(
  svc: ReturnType<typeof createServiceClient>,
  trip_id: string,
  caller_user_id: string,
  kind: "flyer_render",
  provider: "self",
  model: string,
  duration_ms: number,
  error_code: string | null,
) {
  await svc.from("phase_b_generation_log").insert({
    trip_id, caller_user_id, kind, provider, model, duration_ms, error_code,
  });
}
