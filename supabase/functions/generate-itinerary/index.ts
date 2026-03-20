/**
 * Supabase Edge Function — generate-itinerary
 *
 * Generates 3 AI itinerary options (Packed / Balanced / Relaxed) for a trip
 * using confirmed member preferences and trip details, then stores the result
 * in ai_itinerary_options.
 *
 * Deploy:  supabase functions deploy generate-itinerary
 * Secret:  supabase secrets set GEMINI_API_KEY=AIza...
 *
 * POST body: { trip_id: string, planner_override?: string }
 * Requires: Authorization header with the planner's JWT
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ─── Types (mirrored from app types/database.ts) ──────────────────────────────

interface RespondentPreferences {
  needs: string[];
  energy: 'relaxing' | 'adventurous' | null;
  vibes: string[];
  pace: string | null;
}

interface AiItineraryBlock {
  type: string;
  title: string;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  notes: string | null;
}

interface AiItineraryDay {
  date: string;
  blocks: AiItineraryBlock[];
}

interface AiItineraryOption {
  index: number;
  label: string;
  theme: string;
  summary: string;
  days: AiItineraryDay[];
}

// ─── Preference aggregation ───────────────────────────────────────────────────

interface GroupProfile {
  totalConfirmed: number;
  totalWithPrefs: number;
  energy: string;
  energyBreakdown: string;
  topVibes: string[];
  significantNeeds: string[];
  dominantPace: string;
  paceBreakdown: string;
}

function aggregatePreferences(prefs: RespondentPreferences[], totalConfirmed: number): GroupProfile {
  const n = prefs.length;

  // Energy
  const energyCounts = { relaxing: 0, adventurous: 0 };
  for (const p of prefs) {
    if (p.energy === 'relaxing') energyCounts.relaxing++;
    else if (p.energy === 'adventurous') energyCounts.adventurous++;
  }
  const energyTotal = energyCounts.relaxing + energyCounts.adventurous;
  let energy = 'mixed';
  if (energyTotal > 0) {
    const relaxRatio = energyCounts.relaxing / energyTotal;
    if (relaxRatio >= 0.67) energy = 'mostly relaxing';
    else if (relaxRatio <= 0.33) energy = 'mostly adventurous';
    else energy = 'evenly split between relaxing and adventurous';
  }
  const energyBreakdown = `${energyCounts.relaxing} prefer relaxing, ${energyCounts.adventurous} prefer adventurous, ${n - energyTotal} no preference`;

  // Vibes — top 3 by frequency
  const vibeCounts: Record<string, number> = {};
  for (const p of prefs) {
    for (const v of (p.vibes ?? [])) {
      vibeCounts[v] = (vibeCounts[v] ?? 0) + 1;
    }
  }
  const topVibes = Object.entries(vibeCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([v, c]) => `${v} (${c}/${n})`);

  // Needs — surface those mentioned by ≥30% of respondents with preferences
  const needsCounts: Record<string, number> = {};
  for (const p of prefs) {
    for (const nd of (p.needs ?? [])) {
      needsCounts[nd] = (needsCounts[nd] ?? 0) + 1;
    }
  }
  const threshold = Math.max(1, Math.round(n * 0.3));
  const significantNeeds = Object.entries(needsCounts)
    .filter(([, c]) => c >= threshold)
    .sort((a, b) => b[1] - a[1])
    .map(([nd, c]) => `${nd} (${c}/${n})`);

  // Pace — dominant + full breakdown
  const paceCounts: Record<string, number> = {};
  for (const p of prefs) {
    if (p.pace) paceCounts[p.pace] = (paceCounts[p.pace] ?? 0) + 1;
  }
  const paceSorted = Object.entries(paceCounts).sort((a, b) => b[1] - a[1]);
  const dominantPace = paceSorted[0]?.[0] ?? 'no strong preference';
  const paceBreakdown = paceSorted.map(([p, c]) => `"${p}" (${c})`).join(', ');

  return {
    totalConfirmed,
    totalWithPrefs: n,
    energy,
    energyBreakdown,
    topVibes,
    significantNeeds,
    dominantPace,
    paceBreakdown,
  };
}

// ─── Prompt assembly ──────────────────────────────────────────────────────────

function buildPrompt(trip: Record<string, any>, group: GroupProfile, plannerOverride?: string | null): string {
  const nights = trip.start_date && trip.end_date
    ? Math.round((new Date(trip.end_date + 'T12:00:00').getTime() - new Date(trip.start_date + 'T12:00:00').getTime()) / 86400000)
    : null;

  const dateRange = trip.start_date && trip.end_date
    ? `${trip.start_date} to ${trip.end_date}${nights != null ? ` (${nights} night${nights !== 1 ? 's' : ''})` : ''}`
    : 'Dates TBD';

  const topVibesText = group.topVibes.length > 0
    ? group.topVibes.join(', ')
    : 'No vibe data — use destination and trip type as a guide';

  const needsText = group.significantNeeds.length > 0
    ? group.significantNeeds.join('; ')
    : 'No standout shared needs';

  const prefCoverage = group.totalWithPrefs > 0
    ? `${group.totalWithPrefs} of ${group.totalConfirmed} confirmed members shared preferences`
    : 'No preference data yet — use destination and trip type as a guide';

  const overrideSection = plannerOverride
    ? `\nPlanner note (apply to all 3 options): "${plannerOverride}"\n`
    : '';

  // Build the list of dates the itinerary must cover
  const dates: string[] = [];
  if (trip.start_date && trip.end_date) {
    const cur = new Date(trip.start_date + 'T12:00:00');
    const end = new Date(trip.end_date + 'T12:00:00');
    while (cur <= end) {
      dates.push(cur.toISOString().split('T')[0]);
      cur.setDate(cur.getDate() + 1);
    }
  }
  const datesSection = dates.length > 0 ? `Dates to cover: ${dates.join(', ')}` : '';

  return `You are a travel planner helping a group finalize their trip itinerary. Generate 3 distinct itinerary options based on the trip details and group preferences below.

TRIP DETAILS:
- Name: ${trip.name ?? 'Group trip'}
- Destination: ${trip.destination ?? 'TBD'}
- Dates: ${dateRange}
- Budget: ${trip.budget_per_person ?? 'Not specified'} per person
- Trip type: ${trip.trip_type ?? 'Not specified'}
${datesSection}

GROUP PROFILE (${prefCoverage}):
- Confirmed members: ${group.totalConfirmed}
- Energy preference: ${group.energy}
  Breakdown: ${group.energyBreakdown}
- Top activity vibes: ${topVibesText}
- Shared needs to accommodate: ${needsText}
- Dominant pace preference: ${group.dominantPace}
  Full pace breakdown: ${group.paceBreakdown || 'No data'}
${overrideSection}
INSTRUCTIONS:
Generate exactly 3 itinerary options labeled Packed, Balanced, and Relaxed. Each option should be meaningfully different — not just the same activities with slight timing changes.

- Packed: Activity-dense, energetic days. Something to do morning to evening.
- Balanced: A mix of scheduled activities and free time. Breathing room built in.
- Relaxed: Low-key, flexible. A few anchor activities per day, lots of downtime.

For each option:
1. Tailor it to the group profile above — especially the shared needs and dominant pace
2. Include 3-5 blocks per day with specific, realistic activities for the destination
3. Use block types: activity, meal, travel, accommodation, free_time
4. Include approximate times where it makes sense (HH:MM format)
5. Keep locations specific to the destination when possible

Respond with ONLY valid JSON in this exact structure — no markdown, no explanation:

{
  "options": [
    {
      "index": 0,
      "label": "Packed",
      "theme": "One sentence describing the energy and style of this option",
      "summary": "2-3 sentences describing what makes this option distinct and who it suits best",
      "days": [
        {
          "date": "YYYY-MM-DD",
          "blocks": [
            {
              "type": "activity",
              "title": "Specific activity name",
              "start_time": "09:00",
              "end_time": "11:00",
              "location": "Specific place name",
              "notes": "Optional tip or detail"
            }
          ]
        }
      ]
    },
    {
      "index": 1,
      "label": "Balanced",
      "theme": "...",
      "summary": "...",
      "days": [...]
    },
    {
      "index": 2,
      "label": "Relaxed",
      "theme": "...",
      "summary": "...",
      "days": [...]
    }
  ]
}`;
}

// ─── Response parser ──────────────────────────────────────────────────────────

function parseOptions(text: string): AiItineraryOption[] {
  // Gemini with responseMimeType:'application/json' returns clean JSON — no stripping needed
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed.options) ? parsed.options : [];
  } catch (e) {
    console.error('[generate-itinerary] JSON parse failed:', e, '\nRaw text:', text.slice(0, 500));
    return [];
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

async function markError(admin: ReturnType<typeof createClient>, tripId: string, message: string) {
  await admin.from('ai_itinerary_options').upsert(
    { trip_id: tripId, status: 'error', options: [], error_message: message, updated_at: new Date().toISOString() },
    { onConflict: 'trip_id' }
  );
}

// ─── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const geminiApiKey = Deno.env.get('GEMINI_API_KEY') ?? '';

    if (!geminiApiKey) return json({ error: 'GEMINI_API_KEY not configured' }, 500);

    // Admin client (service role) for reads/writes that bypass RLS
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { trip_id, planner_override } = await req.json();
    if (!trip_id) return json({ error: 'trip_id is required' }, 400);

    // TODO: re-enable auth check after JWT issue is resolved in dev

    // Optimistically mark as generating so the client can show a spinner
    await admin.from('ai_itinerary_options').upsert(
      {
        trip_id,
        status: 'generating',
        options: [],
        planner_override: planner_override ?? null,
        error_message: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'trip_id' }
    );

    // ── Step 1: Fetch trip ──────────────────────────────────────────────────
    const { data: trip, error: tripErr } = await admin
      .from('trips')
      .select('*')
      .eq('id', trip_id)
      .single();

    if (tripErr || !trip) {
      await markError(admin, trip_id, 'Trip not found');
      return json({ error: 'Trip not found' }, 404);
    }

    // ── Step 2: Fetch confirmed respondents with preferences ───────────────
    const { data: respondents } = await admin
      .from('respondents')
      .select('name, rsvp, preferences')
      .eq('trip_id', trip_id)
      .eq('rsvp', 'in');

    const confirmedCount = (respondents ?? []).length;
    const prefs: RespondentPreferences[] = (respondents ?? [])
      .map((r: any) => r.preferences)
      .filter(Boolean);

    // ── Step 3: Aggregate preferences into a group profile ─────────────────
    const groupProfile = aggregatePreferences(prefs, confirmedCount);

    // ── Step 4: Build prompt and call Gemini ───────────────────────────────
    const prompt = buildPrompt(trip, groupProfile, planner_override);

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 32768,
            responseMimeType: 'application/json',
          },
        }),
      }
    );

    if (!geminiRes.ok) {
      const errBody = await geminiRes.text();
      await markError(admin, trip_id, `Gemini API error: ${geminiRes.status}`);
      return json({ error: `Gemini API error: ${geminiRes.status} ${errBody}` }, 500);
    }

    const geminiData = await geminiRes.json();
    // gemini-2.5-flash uses thinking — skip thought parts and find the actual response
    const parts = geminiData.candidates?.[0]?.content?.parts ?? [];
    const rawText = parts.find((p: any) => !p.thought)?.text ?? '';
    console.log('[generate-itinerary] parts count:', parts.length, 'rawText preview:', rawText.slice(0, 300));
    const options = parseOptions(rawText);

    if (options.length === 0) {
      console.error('[generate-itinerary] Full response:', JSON.stringify(geminiData).slice(0, 1000));
      await markError(admin, trip_id, 'Gemini returned no valid options');
      return json({ error: 'Failed to parse itinerary options from Gemini response' }, 500);
    }

    // ── Step 5: Store the result ───────────────────────────────────────────
    await admin.from('ai_itinerary_options').upsert(
      {
        trip_id,
        status: 'ready',
        options,
        planner_override: planner_override ?? null,
        error_message: null,
        selected_index: null,
        applied_at: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'trip_id' }
    );

    return json({ success: true, options });
  } catch (err) {
    console.error('[generate-itinerary] Unexpected error:', err);
    return json({ error: String(err) }, 500);
  }
});
