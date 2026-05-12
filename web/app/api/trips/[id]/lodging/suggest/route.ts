/**
 * POST /api/trips/[id]/lodging/suggest
 *
 * Authed planner/cohost asks Gemini (grounded) for 3-5 lodging
 * suggestions tuned to the trip's profile aggregate + destination
 * + dates + group size. Inserts the results into lodging_options
 * with ai_suggested=true.
 *
 * Body: { regenerate?: boolean }
 *   - regenerate=true: delete existing ai_suggested rows for this
 *     trip first, then insert fresh.
 */

import { requireAuthUid } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { aggregateTripProfiles } from "@/lib/ai/aggregate";
import { callGeminiJson } from "@/lib/ai/gemini";
import { jsonErr, jsonOk } from "@/lib/http";
import type { Respondent, Trip, TravelerProfile, TripProfileAggregate } from "@shared/types";

interface GeminiLodgingOption {
  name: string;                                 // ≤ 100 chars
  platform: "airbnb" | "vrbo" | "booking" | "hotel" | "other";
  url?: string;
  notes?: string;                               // why this fits the group
  nightly_rate_usd?: number;                    // rough estimate
  total_cost_usd?: number;                      // for the trip duration
  room_layout?: {
    room: string;                               // "BR1", "Loft", etc.
    beds: string;                               // "1 King", "2 Queens"
  }[];
}

interface GeminiLodgingResponse {
  options: GeminiLodgingOption[];
  note?: string;
}

const ALLOWED_PLATFORMS = new Set(["airbnb", "vrbo", "booking", "hotel", "other"]);

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const r = await requireAuthUid();
  if (!r.ok) return jsonErr(r.status, "unauthenticated");
  const { id: trip_id } = await ctx.params;

  const body = (await req.json().catch(() => ({}))) as { regenerate?: boolean };

  // Authorize + fetch trip.
  const { data: trip, error: tripErr } = await r.supabase
    .from("trips")
    .select("id, name, destination, start_date, end_date, theme, created_by, group_size_bucket")
    .eq("id", trip_id)
    .maybeSingle();
  if (tripErr) return jsonErr(500, "trip_read_failed", tripErr.message);
  if (!trip)   return jsonErr(404, "trip_not_found");

  const isPlanner = trip.created_by === r.authUid;
  if (!isPlanner) {
    const { data: cohost } = await r.supabase
      .from("trip_cohosts").select("trip_id")
      .eq("trip_id", trip_id).eq("user_id", r.authUid).maybeSingle();
    if (!cohost) return jsonErr(403, "forbidden");
  }

  if (!trip.destination) return jsonErr(400, "destination_required",
    "Set a destination on the trip before requesting lodging suggestions.");
  if (!trip.start_date || !trip.end_date) return jsonErr(400, "dates_required",
    "Set start + end dates first.");

  const svc = createServiceClient();
  const aggregate = await computeAggregate(svc, trip_id);

  const prompt = buildPrompt({
    name: trip.name,
    destination: trip.destination,
    start_date: trip.start_date,
    end_date: trip.end_date,
    group_size: trip.group_size_bucket ?? "5-8",
    aggregate,
  });

  const result = await callGeminiJson<GeminiLodgingResponse>({
    admin: svc,
    tripId: trip_id,
    callerUserId: r.authUid,
    kind: "lodging_suggest",
    user: prompt,
    grounded: true,
    maxOutputTokens: 2400,
  });

  if (!result.ok) return jsonErr(502, "gemini_failed", result.error);

  const options = Array.isArray(result.data.options) ? result.data.options : [];
  if (options.length === 0) return jsonErr(502, "gemini_no_options", "Gemini returned no options.");

  if (body.regenerate) {
    await svc
      .from("lodging_options")
      .delete()
      .eq("trip_id", trip_id)
      .eq("ai_suggested", true);
  }

  const nights = nightsBetween(trip.start_date, trip.end_date);

  const rows = options
    .filter((o) => o.name?.trim())
    .map((o, idx) => {
      const platform = ALLOWED_PLATFORMS.has(o.platform) ? o.platform : "other";
      const nightly_rate_cents =
        typeof o.nightly_rate_usd === "number" ? Math.round(o.nightly_rate_usd * 100) : null;
      const total_cost_cents =
        typeof o.total_cost_usd === "number" ? Math.round(o.total_cost_usd * 100) :
        (nightly_rate_cents ? nightly_rate_cents * nights : null);
      const room_layout = Array.isArray(o.room_layout)
        ? o.room_layout.map((rm) => ({
            room: String(rm.room ?? "").slice(0, 60),
            beds: String(rm.beds ?? "").slice(0, 60),
          }))
        : null;
      return {
        trip_id,
        title: o.name.trim().slice(0, 200),
        platform,
        url: o.url?.trim() ?? null,
        notes: o.notes?.trim().slice(0, 1000) ?? null,
        nightly_rate_cents,
        total_cost_cents,
        room_layout,
        ai_suggested: true,
        status: "option",
        position: idx,
        check_in_date: trip.start_date,
        check_out_date: trip.end_date,
      };
    });

  const { data: inserted, error: insErr } = await svc
    .from("lodging_options")
    .insert(rows)
    .select("*");
  if (insErr) return jsonErr(500, "lodging_insert_failed", insErr.message);

  await svc.from("activity_feed_entries").insert({
    trip_id,
    user_id: null,
    entry_type: "system",
    content: {
      text: `AI lodging suggestions: ${rows.length} option${rows.length === 1 ? "" : "s"}.`,
      kind: "lodging_suggested",
      count: rows.length,
    },
  });

  return jsonOk({
    inserted: inserted ?? [],
    count: rows.length,
    note: result.data.note ?? null,
  });
}

// ─── Helpers ────────────────────────────────────────────────────

async function computeAggregate(
  svc: ReturnType<typeof createServiceClient>,
  trip_id: string,
): Promise<TripProfileAggregate> {
  const { data: respondents } = await svc
    .from("respondents")
    .select("id, phone, name")
    .eq("trip_id", trip_id)
    .eq("rsvp_status", "going");
  const goingRespondents = (respondents ?? []) as Pick<Respondent, "id" | "phone" | "name">[];
  const phones = goingRespondents.map((r) => r.phone).filter((p): p is string => !!p);

  type Slice = Pick<TravelerProfile,
    | "vibe_beach_or_mountain" | "vibe_spa_or_hike" | "vibe_foodie_or_casual"
    | "vibe_social_or_chill" | "vibe_culture_or_relaxation"
    | "budget_comfort" | "home_airport" | "dietary_restrictions" | "vibe_captured_at"
  >;
  const profilesByPhone = new Map<string, Slice>();
  if (phones.length > 0) {
    const { data: profiles } = await svc
      .from("traveler_profiles")
      .select("phone, vibe_beach_or_mountain, vibe_spa_or_hike, vibe_foodie_or_casual, vibe_social_or_chill, vibe_culture_or_relaxation, budget_comfort, home_airport, dietary_restrictions, vibe_captured_at")
      .in("phone", phones);
    for (const p of (profiles ?? []) as (Slice & { phone: string })[]) {
      profilesByPhone.set(p.phone, p);
    }
  }
  return aggregateTripProfiles({ tripId: trip_id, goingRespondents, profilesByPhone });
}

function buildPrompt({
  name, destination, start_date, end_date, group_size, aggregate,
}: {
  name: string;
  destination: string;
  start_date: string;
  end_date: string;
  group_size: string;
  aggregate: TripProfileAggregate;
}): string {
  const nights = nightsBetween(start_date, end_date);
  const vibes = JSON.stringify(aggregate.vibes, null, 2);
  const budget = aggregate.budget_comfort.skewed;
  const goingCount = aggregate.going_count || group_size;

  return `Suggest 3-5 lodging options for this group trip. Use real properties on real platforms with real listing pages — cite the listing URLs you reference. Use Google Search to ground prices + availability against the trip dates.

Trip: "${name}" to ${destination}
Dates: ${start_date} → ${end_date} (${nights} nights)
Group: ${goingCount} people

Aggregated group preferences (from travel profiles of the going members):
- Vibes:
${vibes}
- Budget skew: ${budget}
- Alignment: ${aggregate.alignment_summary}

Constraints
- Match the budget skew. 'budget' = under ~$200/night for the whole group. 'mid' = $200-600/night. 'premium' = $600-1500. 'luxury' = $1500+.
- Honor the vibe skews. Beachy + chill → beach houses + condos with views; mountain + hike → cabins with trails; foodie + social → city apartments near restaurants.
- Sleeping arrangements should accommodate everyone (≥ ceil(${goingCount} / 2) bedrooms preferred).
- Provide a 1-sentence "notes" field per option explaining why this fits the group.

Output strict JSON only (no prose, no fences):
{
  "options": [
    {
      "name": "Property name (≤100 chars)",
      "platform": "airbnb" | "vrbo" | "booking" | "hotel" | "other",
      "url": "https://...",
      "notes": "1 sentence on why this fits",
      "nightly_rate_usd": 250,           // approximate, in USD
      "total_cost_usd": 1000,            // optional; computed if omitted
      "room_layout": [{ "room": "BR1", "beds": "1 King" }, ...]
    }
  ],
  "note": "(optional) caveats — e.g., 'pricing as of today; verify on listing'"
}`;
}

function nightsBetween(start: string, end: string): number {
  const s = new Date(start + "T00:00:00").getTime();
  const e = new Date(end + "T00:00:00").getTime();
  return Math.max(1, Math.round((e - s) / (24 * 3600 * 1000)));
}
