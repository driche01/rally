/**
 * POST /api/trips/[id]/itinerary/generate
 *
 * Authed planner/cohost generates a day-by-day itinerary draft via
 * Claude, anchored on the trip's profile aggregate. Inserts the
 * results into itinerary_blocks with ai_generated=true.
 *
 * Body: { regenerate?: boolean }
 *   - regenerate=true: delete existing ai_generated rows for this
 *     trip first, then insert fresh. Default (false) appends new
 *     items alongside any existing ones.
 *
 * Empty-profile handling per build guide §4: if profile_complete_count
 * is 0, the prompt warns Claude that this is a "first pass with no
 * profile data" so it returns generic suggestions plus a hedging note.
 */

import { requireAuthUid } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { aggregateTripProfiles } from "@/lib/ai/aggregate";
import { callClaudeJson } from "@/lib/ai/anthropic";
import { jsonErr, jsonOk } from "@/lib/http";
import type { Respondent, Trip, TravelerProfile, TripProfileAggregate } from "@shared/types";

interface ClaudeItineraryItem {
  day_date: string;          // ISO date, falls on/between trip start/end
  start_time?: string;       // HH:MM, optional
  end_time?: string;
  title: string;             // ≤ 60 chars
  description?: string;
  location?: string;
  type: "activity" | "meal" | "free_time" | "lodging" | "transit" | "other";
}

interface ClaudeItineraryResponse {
  items: ClaudeItineraryItem[];
  note?: string;
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const r = await requireAuthUid();
  if (!r.ok) return jsonErr(r.status, "unauthenticated");
  const { id: trip_id } = await ctx.params;

  const body = (await req.json().catch(() => ({}))) as { regenerate?: boolean };

  // 1. Authorize + fetch trip.
  const { data: trip, error: tripErr } = await r.supabase
    .from("trips")
    .select("id, name, destination, start_date, end_date, theme, created_by")
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

  if (!trip.start_date || !trip.end_date) {
    return jsonErr(400, "dates_required",
      "Set trip start + end dates before generating an itinerary.");
  }

  // 2. Pull profile aggregate (no cache — fresh data for the AI call).
  const svc = createServiceClient();
  const aggregate = await computeAggregate(svc, trip_id);

  // 3. Find the planner's own respondent row for created_by FK.
  const { data: plannerResp } = await svc
    .from("respondents")
    .select("id")
    .eq("trip_id", trip_id)
    .eq("is_planner", true)
    .maybeSingle();
  const planner_respondent_id = plannerResp?.id ?? null;

  // 4. Build + send the Claude prompt.
  const prompt = buildPrompt({
    name: trip.name,
    destination: trip.destination,
    start_date: trip.start_date,
    end_date: trip.end_date,
    aggregate,
  });

  const result = await callClaudeJson<ClaudeItineraryResponse>({
    admin: svc,
    tripId: trip_id,
    callerUserId: r.authUid,
    kind: "itinerary_generate",
    user: prompt,
    maxTokens: 4000,
  });

  if (!result.ok) return jsonErr(502, "claude_failed", result.error);

  const items = Array.isArray(result.data.items) ? result.data.items : [];
  if (items.length === 0) {
    return jsonErr(502, "claude_no_items", "Claude returned no items.");
  }

  // 5. If regenerate=true, wipe existing ai_generated rows.
  if (body.regenerate) {
    await svc
      .from("itinerary_blocks")
      .delete()
      .eq("trip_id", trip_id)
      .eq("ai_generated", true);
  }

  // 6. Insert items. Validate dates fall in range; clamp times.
  // Claude sometimes hallucinates the same item twice (e.g.,
  // "Dinner at Ahwahnee" + "Dinner at The Ahwahnee Dining Room"
  // for the same evening). Dedupe within the response before we
  // persist, keeping the first occurrence.
  const startTs = new Date(trip.start_date + "T00:00:00").getTime();
  const endTs   = new Date(trip.end_date   + "T23:59:59").getTime();

  const seenKeys = new Set<string>();
  const seenSig  = new Set<string>();
  const rows = items
    .filter((it) => {
      if (!it.title?.trim() || !it.day_date) return false;
      const ts = new Date(it.day_date + "T00:00:00").getTime();
      return ts >= startTs && ts <= endTs;
    })
    .filter((it) => {
      // Hard dedupe: same day + same start time + same normalized title.
      const hardKey = `${it.day_date}|${cleanTime(it.start_time) ?? ""}|${normalizeTitle(it.title)}`;
      if (seenKeys.has(hardKey)) return false;
      seenKeys.add(hardKey);
      // Soft dedupe: same day + same start time + similar location-or-title
      // shingles. Catches "Dinner at Ahwahnee" vs "Dinner at The Ahwahnee
      // Dining Room" at 6:30 PM.
      const softSig = `${it.day_date}|${cleanTime(it.start_time) ?? ""}|${normalizedSignature(it.title, it.location)}`;
      if (seenSig.has(softSig)) return false;
      seenSig.add(softSig);
      return true;
    })
    .map((it, idx) => ({
      trip_id,
      day_date:    it.day_date,
      type:        normalizeType(it.type),
      title:       it.title.trim().slice(0, 200),
      start_time:  cleanTime(it.start_time),
      end_time:    cleanTime(it.end_time),
      location:    it.location?.trim().slice(0, 200) ?? null,
      notes:       it.description?.trim().slice(0, 1000) ?? null,
      position:    idx,
      ai_generated: true,
      created_by:  planner_respondent_id,
    }));

  if (rows.length === 0) {
    return jsonErr(502, "claude_items_out_of_range", "Claude items didn't fall within trip dates.");
  }

  const { data: inserted, error: insErr } = await svc
    .from("itinerary_blocks")
    .insert(rows)
    .select("*");
  if (insErr) return jsonErr(500, "itinerary_insert_failed", insErr.message);

  // 7. Auto-post a system entry to the activity feed.
  await svc.from("activity_feed_entries").insert({
    trip_id,
    user_id: null,
    entry_type: "system",
    content: {
      text: `AI itinerary draft: ${rows.length} item${rows.length === 1 ? "" : "s"}.`,
      kind: "itinerary_generated",
      count: rows.length,
    },
  });

  return jsonOk({
    inserted: inserted ?? [],
    count: rows.length,
    note: result.data.note ?? null,
    profile_complete_count: aggregate.profile_complete_count,
    going_count: aggregate.going_count,
  });
}

// ─── Helpers ──────────────────────────────────────────────────

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
      .select(
        "phone, vibe_beach_or_mountain, vibe_spa_or_hike, vibe_foodie_or_casual, vibe_social_or_chill, vibe_culture_or_relaxation, budget_comfort, home_airport, dietary_restrictions, vibe_captured_at",
      )
      .in("phone", phones);
    for (const p of (profiles ?? []) as (Slice & { phone: string })[]) {
      profilesByPhone.set(p.phone, p);
    }
  }

  return aggregateTripProfiles({ tripId: trip_id, goingRespondents, profilesByPhone });
}

function buildPrompt({
  name, destination, start_date, end_date, aggregate,
}: {
  name: string;
  destination: string | null;
  start_date: string;
  end_date: string;
  aggregate: TripProfileAggregate;
}): string {
  const days = enumerateDays(start_date, end_date);
  const dayCount = days.length;
  const vibesSummary = JSON.stringify(aggregate.vibes, null, 2);
  const budget = aggregate.budget_comfort.skewed;
  const diets = aggregate.dietary_restrictions.map((d) => `${d.value} (${d.count})`).join(", ") || "none";
  const profileHedge = aggregate.profile_complete_count === 0
    ? `\n\nIMPORTANT: zero profiles complete yet (${aggregate.going_count} going). Generate generic-but-tasteful suggestions and include a brief "note" field flagging the data is thin.`
    : aggregate.profile_complete_count < aggregate.going_count / 2
    ? `\n\nNOTE: only ${aggregate.profile_complete_count} of ${aggregate.going_count} profiles complete. Generate against the available signal but include a brief "note" field noting it may shift.`
    : "";

  return `Generate a draft day-by-day itinerary for this group trip.

Trip: "${name}"${destination ? ` to ${destination}` : ""}
Dates: ${start_date} → ${end_date} (${dayCount} day${dayCount === 1 ? "" : "s"})
Days: ${JSON.stringify(days)}

Aggregated group preferences (from travel profiles of the going members):
- Vibes (counts per dimension, plus 'skewed' = majority value):
${vibesSummary}
- Budget comfort skew: ${budget}
- Dietary restrictions across the group: ${diets}
- Home airports: ${aggregate.home_airports.map((a) => a.value).join(", ") || "unknown"}
- Alignment summary: ${aggregate.alignment_summary}${profileHedge}

Constraints
- Output 4-8 items per day. Mix of meals, activities, and free time.
- Honor the dietary restrictions when suggesting restaurants / meals.
- Match the budget skew (under $500 = budget; $500-1.5k = mid; etc.).
- Honor the vibe skews — e.g. 'chill' means fewer pack-the-day activities, 'social' means group dining + bars.
- Day 1 should ramp easy (arrival day). Final day should wind down (departure).
- Times are local to the destination.

Output JSON schema (strict):
{
  "items": [
    {
      "day_date": "YYYY-MM-DD",          // must be one of the listed days
      "start_time": "HH:MM",             // optional, 24h
      "end_time": "HH:MM",               // optional
      "title": "string (≤60 chars)",
      "description": "string (one-sentence why)",
      "location": "string (place / area name)",
      "type": "activity" | "meal" | "free_time" | "lodging" | "transit" | "other"
    }
  ],
  "note": "string (optional planner-facing hedge if data is thin)"
}`;
}

function enumerateDays(start: string, end: string): string[] {
  const out: string[] = [];
  const s = new Date(start + "T00:00:00").getTime();
  const e = new Date(end   + "T00:00:00").getTime();
  for (let t = s; t <= e; t += 24 * 3600 * 1000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

function normalizeType(t: string): string {
  const allowed = new Set(["activity","meal","free_time","lodging","transit","other"]);
  return allowed.has(t) ? t : "other";
}

/**
 * Lower, strip leading articles, strip non-alphanumeric, collapse
 * whitespace. Used for the hard-dedupe key.
 */
function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b(the|a|an)\b/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Bag-of-shingle signature for soft dedupe — catches near-duplicates
 * where Claude paraphrases the same activity ("Dinner at Ahwahnee" vs
 * "Dinner at The Ahwahnee Dining Room"). Returns a sorted, distinct
 * set of length-3 word shingles from the title + location.
 */
function normalizedSignature(title: string, location: string | null | undefined): string {
  const words = normalizeTitle(`${title} ${location ?? ""}`).split(" ").filter(Boolean);
  if (words.length === 0) return "";
  // Distinct-ordered tokens — order doesn't matter for the signature.
  const distinct = Array.from(new Set(words)).sort();
  return distinct.join("|");
}

function cleanTime(s?: string): string | null {
  if (!s) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(s.trim());
  if (!m) return null;
  const h = Math.max(0, Math.min(23, parseInt(m[1]!, 10)));
  const mm = Math.max(0, Math.min(59, parseInt(m[2]!, 10)));
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}
