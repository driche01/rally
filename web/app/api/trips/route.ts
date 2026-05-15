/**
 * /api/trips
 *   GET  — list trips the caller created (or co-hosts)
 *   POST — create a new trip
 *
 * RLS does most of the gating; this handler just shapes the
 * request/response and adds basic validation. Build guide §6 Step 3
 * (trip creation flow UI) consumes POST.
 */

import { randomBytes } from "crypto";
import { requireAuthUid } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { json, jsonErr, jsonOk } from "@/lib/http";
import type { Trip, TripTheme } from "@shared/types";

export async function GET() {
  const r = await requireAuthUid();
  if (!r.ok) return jsonErr(r.status, "unauthenticated");

  // Planner-owned + co-hosted trips, newest first. RLS guarantees
  // we won't see anyone else's even if the query asked.
  const { data, error } = await r.supabase
    .from("trips")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) return jsonErr(500, "trips_read_failed", error.message);
  return jsonOk(data as Trip[]);
}

const ALLOWED_THEMES: ReadonlySet<TripTheme> = new Set([
  "classic","eclectic","fancy","literary","digital","elegant",
]);

export async function POST(req: Request) {
  const r = await requireAuthUid();
  if (!r.ok) return jsonErr(r.status, "unauthenticated");

  const body = await safeJson(req);
  if (!body || typeof body !== "object") return jsonErr(400, "invalid_json");

  // We tolerate the entire shape but validate the load-bearing bits.
  const name = strOrNull(body.name);
  if (!name) return jsonErr(400, "name_required");
  if (name.length > 60) return jsonErr(400, "name_too_long");

  const theme = strOrNull(body.theme) as TripTheme | null;
  if (theme && !ALLOWED_THEMES.has(theme)) return jsonErr(400, "invalid_theme");

  const start_date = strOrNull(body.start_date);
  const end_date   = strOrNull(body.end_date);
  if (start_date && end_date && start_date > end_date) {
    return jsonErr(400, "end_before_start");
  }

  // Q35: book_by_date REQUIRED at trip creation. DB column stays
  // nullable to support legacy rows; new trips must provide it.
  const book_by_date = strOrNull(body.book_by_date);
  if (!book_by_date) return jsonErr(400, "book_by_date_required");
  if (start_date && book_by_date > start_date) {
    return jsonErr(400, "book_by_after_start");
  }

  const budget_min = numOrNull(body.budget_min);
  const budget_max = numOrNull(body.budget_max);
  if (budget_min != null && budget_max != null && budget_min > budget_max) {
    return jsonErr(400, "budget_min_gt_max");
  }

  // group_size_bucket has a CHECK constraint and is required on the
  // existing schema. Default to '5-8' for now; Step 3 UI will let
  // the planner choose.
  const group_size_bucket = strOrNull(body.group_size_bucket) ?? "5-8";

  const insert = {
    created_by:      r.authUid,
    name,
    group_size_bucket,
    theme,
    destination:     strOrNull(body.destination),
    description:     strOrNull(body.description),
    cover_image_url: strOrNull(body.cover_image_url),
    is_public:       Boolean(body.is_public ?? false),
    start_date,
    end_date,
    book_by_date,
    budget_min,
    budget_max,
    status:          body.status === "draft" ? "draft" : "active",
  };

  const { data, error } = await r.supabase
    .from("trips")
    .insert(insert)
    .select("*")
    .single();

  if (error) return jsonErr(500, "trips_insert_failed", error.message);

  // Phase C Q24: auto-create planner self-respondent so the planner
  // can be addressed by blasts and reminders uniformly. Best-effort —
  // if this fails the trip itself still exists; migration 140's
  // idempotent backfill will pick it up later. We use the service
  // client because RLS on respondents doesn't grant the planner
  // INSERT on themselves (it's gated on share_token presence).
  try {
    const svc = createServiceClient();
    const { data: planner } = await svc
      .from("profiles")
      .select("name, last_name, phone, email")
      .eq("id", r.authUid)
      .maybeSingle();

    const plannerName = [planner?.name, planner?.last_name]
      .map((s) => (s ?? "").trim())
      .filter(Boolean)
      .join(" ") || "Planner";

    let user_id: string | null = null;
    if (planner?.phone) {
      const { data: u } = await svc
        .from("users").select("id").eq("phone", planner.phone).maybeSingle();
      user_id = u?.id ?? null;
    }

    await svc.from("respondents").insert({
      trip_id: data.id,
      name: plannerName,
      phone: planner?.phone ?? null,
      email: planner?.email ?? null,
      is_planner: true,
      rsvp_status: "going",
      rsvp_status_updated_at: new Date().toISOString(),
      session_token: randomBytes(16).toString("hex"),
      user_id,
      invited_at: new Date().toISOString(),
    });
  } catch (e) {
    // Don't fail the trip create. Log and move on.
    console.warn("[/api/trips] planner self-respondent insert failed:", e);
  }

  return json({ ok: true, data: data as Trip }, 201);
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
