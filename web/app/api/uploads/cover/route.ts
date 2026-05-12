/**
 * POST /api/uploads/cover
 *
 * Authed planner uploads a trip cover image. Multipart form body:
 *   - file:    the image (PNG/JPEG/WEBP, ≤ 5 MB)
 *
 * Saves to the trip-covers storage bucket (public) under
 * `<userId>/<timestamp>-<random>.<ext>` and returns the public URL.
 *
 * Body limits + content-type validation are enforced server-side.
 * Client UI does its own pre-check but server is the source of
 * truth.
 */

import { requireAuthUid } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { jsonErr, jsonOk } from "@/lib/http";
import { randomBytes } from "node:crypto";

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
]);

export async function POST(req: Request) {
  const r = await requireAuthUid();
  if (!r.ok) return jsonErr(r.status, "unauthenticated");

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonErr(400, "invalid_form_data");
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return jsonErr(400, "file_required");
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    return jsonErr(415, "unsupported_type", `Got ${file.type}; PNG, JPEG, or WEBP only.`);
  }
  if (file.size > MAX_BYTES) {
    return jsonErr(413, "file_too_large", `${file.size} bytes; limit is ${MAX_BYTES}.`);
  }
  if (file.size === 0) {
    return jsonErr(400, "file_empty");
  }

  const ext = extFor(file.type);
  const path = `${r.authUid}/${Date.now()}-${randomBytes(6).toString("hex")}.${ext}`;

  const svc = createServiceClient();
  const buf = new Uint8Array(await file.arrayBuffer());
  const { error: upErr } = await svc.storage
    .from("trip-covers")
    .upload(path, buf, {
      contentType: file.type,
      upsert: false,
    });
  if (upErr) return jsonErr(500, "storage_upload_failed", upErr.message);

  const { data: pub } = svc.storage.from("trip-covers").getPublicUrl(path);
  return jsonOk({ url: pub.publicUrl, path });
}

function extFor(mime: string): string {
  switch (mime) {
    case "image/png":  return "png";
    case "image/webp": return "webp";
    default:           return "jpg";
  }
}
