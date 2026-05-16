/**
 * POST /api/uploads/feed-photo
 *
 * Uploads an image to the activity feed. Mirrors /api/uploads/cover
 * but allows the soft-auth (rally_session_token cookie) path so
 * respondents who've RSVPed can drop a photo into the feed without
 * re-OTPing. Files land in the existing `trip-covers` bucket under
 * a `feed/` path prefix — same retention + public-read settings.
 *
 * Body: multipart form with `file` field (PNG / JPEG / WEBP, ≤5 MB).
 * Returns: { url, path }
 */

import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import { requireAuthUid } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { jsonErr, jsonOk } from "@/lib/http";

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB — same as cover upload.
const ALLOWED_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
]);

export async function POST(req: Request) {
  // Identify uploader. Either path is fine — we just need a non-empty
  // id to namespace the storage path. Falls back to a stable session-
  // derived id for cookie-only respondents.
  let uploaderId: string | null = null;

  const authResult = await requireAuthUid();
  if (authResult.ok) {
    uploaderId = authResult.authUid;
  } else {
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get("rally_session_token")?.value ?? null;
    if (sessionToken) {
      // Hash the session_token to a stable, non-reversible folder
      // name. Keeps storage layout consistent across re-RSVPs and
      // doesn't leak the token itself into URLs.
      uploaderId = `s-${await sha256hex(sessionToken)}`.slice(0, 24);
    }
  }
  if (!uploaderId) return jsonErr(401, "unauthenticated");

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonErr(400, "invalid_form_data");
  }

  const file = form.get("file");
  if (!(file instanceof File)) return jsonErr(400, "file_required");
  if (!ALLOWED_TYPES.has(file.type)) {
    return jsonErr(415, "unsupported_type", `Got ${file.type}; PNG, JPEG, or WEBP only.`);
  }
  if (file.size > MAX_BYTES) {
    return jsonErr(413, "file_too_large", `${file.size} bytes; limit is ${MAX_BYTES}.`);
  }
  if (file.size === 0) return jsonErr(400, "file_empty");

  const ext = extFor(file.type);
  const path = `feed/${uploaderId}/${Date.now()}-${randomBytes(6).toString("hex")}.${ext}`;

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

async function sha256hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
