/**
 * Thin Gemini client with optional Google Search grounding.
 *
 * Per BUILD_QUESTIONS Q14: Gemini handles lodging + flight
 * suggestions because they need real-world prices + availability
 * that the model can ground via search. Claude handles itinerary
 * + meals (no grounding needed; creative output is the win).
 *
 * Cover image generation already uses Gemini separately
 * (/api/uploads/generate-cover) — that route hits the image-gen
 * model directly. This module is for text generation only.
 *
 * Strategy
 *   1. Call a grounded model with the prompt that asks for strict
 *      JSON output.
 *   2. Strip code fences defensively.
 *   3. JSON.parse. On parse error, fall back to a second pass
 *      calling Claude or a non-grounded Gemini to extract JSON
 *      from the grounded text.
 *
 * For Phase B Step 5 v0, the fallback path is "throw with the raw
 * text" — we keep iteration tight and improve the extraction
 * later if real grounded calls turn out to be unreliable JSON
 * producers.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

const MODEL_CANDIDATES = [
  "gemini-2.5-flash",
  "gemini-2.5-pro",
];

export type GroundedKind = "lodging_suggest" | "flight_suggest";

interface CallArgs {
  admin: SupabaseClient;
  tripId: string | null;
  callerUserId: string | null;
  kind: GroundedKind;
  user: string;
  /** Set to false for non-grounded calls (e.g., JSON-only follow-ups). */
  grounded?: boolean;
  maxOutputTokens?: number;
}

interface GeminiResponse {
  candidates?: {
    content?: { parts?: { text?: string }[] };
    groundingMetadata?: unknown;
  }[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
}

interface CallResult<T> {
  ok: true;
  data: T;
  raw: string;
  inputTokens: number | null;
  outputTokens: number | null;
}
interface CallError {
  ok: false;
  error: string;
  rawText?: string;
}

export async function callGeminiJson<T>(args: CallArgs): Promise<CallResult<T> | CallError> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { ok: false, error: "gemini_not_configured" };

  const grounded = args.grounded !== false;
  const body = {
    contents: [{ parts: [{ text: args.user }] }],
    ...(grounded ? { tools: [{ google_search: {} }] } : {}),
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: args.maxOutputTokens ?? 2000,
    },
  };

  const t0 = Date.now();
  let resp: GeminiResponse | null = null;
  let lastErr: string | null = null;
  let modelUsed = "";

  for (const model of MODEL_CANDIDATES) {
    modelUsed = model;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
    let r: Response;
    try {
      r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (e) {
      lastErr = `${model}: ${e instanceof Error ? e.message : "network"}`;
      continue;
    }
    if (r.status === 404) {
      lastErr = `${model}: 404`;
      continue;
    }
    if (!r.ok) {
      const errText = await r.text().catch(() => "");
      lastErr = `${model}: ${r.status}: ${errText.slice(0, 300)}`;
      // 4xx other than 404 are likely the same across models (bad
      // body, auth, etc.) — bail.
      await logRow(args, modelUsed, Date.now() - t0, null, null, lastErr);
      return { ok: false, error: `gemini_error: ${lastErr}` };
    }
    resp = (await r.json().catch(() => null)) as GeminiResponse | null;
    break;
  }

  if (!resp) {
    await logRow(args, modelUsed, Date.now() - t0, null, null, lastErr ?? "no_response");
    return { ok: false, error: `gemini_no_model_available: ${lastErr ?? "unknown"}` };
  }

  const raw = (resp.candidates?.[0]?.content?.parts ?? [])
    .map((p) => p.text ?? "")
    .join("")
    .trim();

  if (!raw) {
    await logRow(args, modelUsed, Date.now() - t0, resp.usageMetadata?.promptTokenCount ?? null, resp.usageMetadata?.candidatesTokenCount ?? null, "empty_content");
    return { ok: false, error: "gemini_empty_content" };
  }

  const stripped = stripFences(raw);
  let parsed: T;
  try {
    parsed = JSON.parse(stripped) as T;
  } catch (e) {
    const inTok = resp.usageMetadata?.promptTokenCount ?? null;
    const outTok = resp.usageMetadata?.candidatesTokenCount ?? null;
    await logRow(args, modelUsed, Date.now() - t0, inTok, outTok, "json_parse_failed");
    return { ok: false, error: `gemini_bad_json: ${(e as Error).message}`, rawText: stripped };
  }

  const inputTokens  = resp.usageMetadata?.promptTokenCount    ?? null;
  const outputTokens = resp.usageMetadata?.candidatesTokenCount ?? null;
  await logRow(args, modelUsed, Date.now() - t0, inputTokens, outputTokens, null);
  return { ok: true, data: parsed, raw, inputTokens, outputTokens };
}

// ─── Helpers ──────────────────────────────────────────────────────

function stripFences(s: string): string {
  const fenceMatch = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  return fenceMatch?.[1] ?? s;
}

async function logRow(
  args: CallArgs,
  model: string,
  duration_ms: number,
  input_tokens: number | null,
  output_tokens: number | null,
  error_code: string | null,
) {
  try {
    await args.admin.from("phase_b_generation_log").insert({
      trip_id: args.tripId,
      caller_user_id: args.callerUserId,
      kind: args.kind,
      provider: "gemini",
      model,
      input_tokens,
      output_tokens,
      duration_ms,
      error_code,
    });
  } catch {
    // best-effort
  }
}
