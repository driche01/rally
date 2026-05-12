/**
 * Thin Anthropic Messages API client. Server-only.
 *
 * Phase B uses this for itinerary + meal-plan AI generation
 * (per BUILD_QUESTIONS Q14). Gemini stays on lodging + flight
 * suggestions where Google Search grounding matters.
 *
 * Returns the parsed JSON object the prompt asked for (Claude is
 * instructed to respond with structured JSON; we attempt to parse
 * the text content as JSON, falling back to a wrapper error).
 *
 * Also writes a phase_b_generation_log row so we have token-cost
 * visibility per (trip, kind).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

const API_URL = "https://api.anthropic.com/v1/messages";
const VERSION = "2023-06-01";

export type GenerationKind =
  | "itinerary_generate"
  | "meal_plan_generate"
  | "ingredient_normalize";

interface CallArgs {
  admin: SupabaseClient;
  tripId: string | null;
  callerUserId: string | null;
  kind: GenerationKind;
  model?: string;
  /** Top-level user prompt. */
  user: string;
  /** Optional system prompt. Defaults to a structured-JSON instruction. */
  system?: string;
  /** Max tokens for the response. */
  maxTokens?: number;
}

interface MessagesResponse {
  content?: { type: string; text?: string }[];
  usage?: { input_tokens?: number; output_tokens?: number };
  stop_reason?: string;
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
}

const DEFAULT_MODEL = "claude-sonnet-4-6";
const DEFAULT_SYSTEM =
  "You are a helpful planner assistant for Rally, a group-trip planning app. " +
  "When the user asks for an output, respond with valid JSON ONLY — no prose, " +
  "no markdown fencing, no commentary. JSON keys + value types match exactly " +
  "what the user requested.";

export async function callClaudeJson<T>(args: CallArgs): Promise<CallResult<T> | CallError> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { ok: false, error: "anthropic_not_configured" };
  }

  const model = args.model ?? DEFAULT_MODEL;
  const t0 = Date.now();
  let res: Response;
  try {
    res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: args.maxTokens ?? 2000,
        system: args.system ?? DEFAULT_SYSTEM,
        messages: [{ role: "user", content: args.user }],
      }),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "network";
    await logRow(args, model, Date.now() - t0, null, null, `network: ${msg}`);
    return { ok: false, error: `anthropic_unreachable: ${msg}` };
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    await logRow(args, model, Date.now() - t0, null, null, `${res.status}: ${errText.slice(0, 200)}`);
    return { ok: false, error: `anthropic_error: ${res.status} ${errText.slice(0, 200)}` };
  }

  const body = (await res.json().catch(() => null)) as MessagesResponse | null;
  if (!body?.content?.length) {
    await logRow(args, model, Date.now() - t0, null, null, "empty_content");
    return { ok: false, error: "anthropic_empty_content" };
  }

  const raw = body.content
    .map((c) => (c.type === "text" ? c.text ?? "" : ""))
    .join("")
    .trim();

  const stripped = stripFences(raw);
  let parsed: T;
  try {
    parsed = JSON.parse(stripped) as T;
  } catch (e) {
    const inputTok  = body.usage?.input_tokens  ?? null;
    const outputTok = body.usage?.output_tokens ?? null;
    await logRow(args, model, Date.now() - t0, inputTok, outputTok, "json_parse_failed");
    return { ok: false, error: `anthropic_bad_json: ${(e as Error).message}` };
  }

  const inputTokens  = body.usage?.input_tokens  ?? null;
  const outputTokens = body.usage?.output_tokens ?? null;
  await logRow(args, model, Date.now() - t0, inputTokens, outputTokens, null);

  return { ok: true, data: parsed, raw, inputTokens, outputTokens };
}

// ─── Helpers ──────────────────────────────────────────────────────

function stripFences(s: string): string {
  // Models sometimes wrap JSON in ```json ... ``` despite the system
  // prompt telling them not to. Strip defensively.
  const fenceMatch = s.match(/^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/);
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
      provider: "anthropic",
      model,
      input_tokens,
      output_tokens,
      duration_ms,
      error_code,
    });
  } catch {
    // Logging is best-effort; don't fail the caller.
  }
}
