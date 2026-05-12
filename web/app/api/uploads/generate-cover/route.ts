/**
 * POST /api/uploads/generate-cover
 *
 * Authed planner generates a trip cover image from a text prompt
 * using Gemini's image-generation model. Saves the result to the
 * trip-covers storage bucket and returns the public URL — same
 * shape as /api/uploads/cover so the trip form treats both paths
 * identically.
 *
 * Body: { prompt: string }
 * Returns: { url: string, path: string }
 *
 * Cost note: each call is one Gemini image generation. Phase A
 * has no per-user rate limit on this endpoint; if we see abuse,
 * easiest knob is a cap of N generations per user per hour. The
 * `requireAuthUid` gate at least keeps anon out.
 */

import { requireAuthUid } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { jsonErr, jsonOk } from "@/lib/http";
import { randomBytes } from "node:crypto";

const MIN_PROMPT = 5;
const MAX_PROMPT = 500;

// Ordered fallback list. `gemini-2.5-flash-image` is the current GA
// image-gen model. The 3.x previews are listed in case Google
// graduates them and the 2.5 endpoint shutters; we try in order
// and stop on the first 200.
//
// If you see "model not found" 404s in prod, run:
//   curl "https://generativelanguage.googleapis.com/v1beta/models?key=$GEMINI_API_KEY" | jq '.models[].name'
// and bump this list.
const MODEL_CANDIDATES = [
  "gemini-2.5-flash-image",
  "gemini-3.1-flash-image-preview",
  "gemini-3-pro-image-preview",
];

export async function POST(req: Request) {
  const r = await requireAuthUid();
  if (!r.ok) return jsonErr(r.status, "unauthenticated");

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return jsonErr(500, "gemini_not_configured",
      "Set GEMINI_API_KEY in /web/.env.local — pulled from /Users/davidriche/Rally/.env.");
  }

  let body: { prompt?: unknown } | null = null;
  try { body = await req.json(); } catch { return jsonErr(400, "invalid_json"); }
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  if (prompt.length < MIN_PROMPT) return jsonErr(400, "prompt_too_short");
  if (prompt.length > MAX_PROMPT) return jsonErr(400, "prompt_too_long");

  // ─── Gemini image generation ──────────────────────────────
  // Doc: https://ai.google.dev/gemini-api/docs/image-generation
  // Try the candidate models in order; first one that returns 200
  // wins. The 2.5 flash image model accepts a text prompt and
  // returns inlineData parts with base64-encoded image bytes.

  // Light prompt scaffold — biases toward landscape-shaped, warm,
  // editorial covers that fit Rally's aesthetic without overriding
  // the planner's input.
  const scaffold =
    `Editorial-style trip cover image, 16:10 aspect ratio, warm natural light, `
    + `cinematic film-grain feel, no text or watermarks. `
    + `Subject: ${prompt}`;

  let json: GeminiResponse | null = null;
  let lastErr: string | null = null;

  for (const model of MODEL_CANDIDATES) {
    const endpoint =
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent` +
      `?key=${encodeURIComponent(apiKey)}`;

    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: scaffold }] }],
          generationConfig: { responseModalities: ["IMAGE"] },
        }),
      });
    } catch (e) {
      lastErr = `${model}: ${e instanceof Error ? e.message : "network"}`;
      continue;
    }

    if (res.status === 404) {
      // Model not found — try the next candidate without bailing.
      lastErr = `${model}: 404`;
      continue;
    }
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      lastErr = `${model}: ${res.status}: ${errText.slice(0, 300)}`;
      // Non-404 errors are likely the same across models (auth, bad
      // body, etc.) — bail.
      return jsonErr(502, "gemini_error", lastErr);
    }
    json = (await res.json().catch(() => null)) as GeminiResponse | null;
    break;
  }

  if (!json) {
    return jsonErr(502, "gemini_no_model_available",
      `None of the candidate models responded. Last error: ${lastErr ?? "unknown"}.`);
  }

  const part = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
  if (!part?.inlineData?.data) {
    return jsonErr(502, "gemini_no_image", "Gemini didn't return an image part.");
  }

  const mime = part.inlineData.mimeType || "image/png";
  const buf = Buffer.from(part.inlineData.data, "base64");
  const ext = mime === "image/jpeg" ? "jpg" : mime === "image/webp" ? "webp" : "png";

  // ─── Save to storage ──────────────────────────────────────
  const path = `${r.authUid}/gen-${Date.now()}-${randomBytes(6).toString("hex")}.${ext}`;
  const svc = createServiceClient();
  const { error: upErr } = await svc.storage
    .from("trip-covers")
    .upload(path, buf, { contentType: mime, upsert: false });
  if (upErr) return jsonErr(500, "storage_upload_failed", upErr.message);

  const { data: pub } = svc.storage.from("trip-covers").getPublicUrl(path);
  return jsonOk({ url: pub.publicUrl, path });
}

interface GeminiResponse {
  candidates?: {
    content?: {
      parts?: { inlineData?: { mimeType: string; data: string } }[];
    };
  }[];
}
