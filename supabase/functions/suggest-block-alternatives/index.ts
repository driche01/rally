/**
 * Supabase Edge Function — suggest-block-alternatives
 *
 * Given an existing itinerary block, generates AI alternative versions of
 * that block based on trip context and group preferences. Returns results
 * directly without storing them (stateless).
 *
 * Deploy:  supabase functions deploy suggest-block-alternatives
 * Secret:  GEMINI_API_KEY (shared with generate-itinerary)
 *
 * POST body:
 *   {
 *     trip_id: string,
 *     block: { type, title, start_time, end_time, location, notes, day_date },
 *     existing_alternatives?: AiBlockAlternative[],  // previous suggestions, for context
 *     user_prompt?: string,                           // planner's freetext nudge
 *   }
 *
 * Response: { alternatives: AiBlockAlternative[] }
 *   - 2 alternatives when no user_prompt
 *   - 1 targeted alternative when user_prompt is provided
 *
 * Requires: Authorization header with the planner's JWT
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ─── Types ─────────────────────────────────────────────────────────────────────

interface InputBlock {
  type: string;
  title: string;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  notes: string | null;
  day_date: string;
}

interface AiBlockAlternative {
  title: string;
  type: string;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  notes: string | null;
  reason: string;
}

interface RespondentPreferences {
  needs: string[];
  energy: 'relaxing' | 'adventurous' | null;
  vibes: string[];
  pace: string | null;
}

// ─── Preference aggregation (lightweight) ─────────────────────────────────────

function buildGroupProfile(prefs: RespondentPreferences[], confirmedCount: number): string {
  if (prefs.length === 0) {
    return `Group of ${confirmedCount} people. No preference data collected yet.`;
  }

  const n = prefs.length;
  const relaxing = prefs.filter((p) => p.energy === 'relaxing').length;
  const adventurous = prefs.filter((p) => p.energy === 'adventurous').length;
  const energyStr =
    relaxing > adventurous
      ? 'leans relaxing'
      : adventurous > relaxing
      ? 'leans adventurous'
      : 'mixed energy';

  const vibeCounts: Record<string, number> = {};
  for (const p of prefs) {
    for (const v of p.vibes ?? []) {
      vibeCounts[v] = (vibeCounts[v] ?? 0) + 1;
    }
  }
  const topVibes = Object.entries(vibeCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([v]) => v);

  const needCounts: Record<string, number> = {};
  for (const p of prefs) {
    for (const need of p.needs ?? []) {
      needCounts[need] = (needCounts[need] ?? 0) + 1;
    }
  }
  const significantNeeds = Object.entries(needCounts)
    .filter(([, count]) => count / n >= 0.3)
    .map(([need]) => need);

  const paceCounts: Record<string, number> = {};
  for (const p of prefs) {
    if (p.pace) paceCounts[p.pace] = (paceCounts[p.pace] ?? 0) + 1;
  }
  const dominantPace = Object.entries(paceCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'flexible';

  return [
    `${confirmedCount} confirmed attendees.`,
    `Energy: ${energyStr}.`,
    topVibes.length ? `Top vibes: ${topVibes.join(', ')}.` : '',
    significantNeeds.length ? `Key group needs: ${significantNeeds.join(', ')}.` : '',
    `Preferred pace: ${dominantPace}.`,
  ]
    .filter(Boolean)
    .join(' ');
}

// ─── Prompt builder ────────────────────────────────────────────────────────────

function formatTime(t: string | null): string {
  if (!t) return 'no specific time';
  const [h, m] = t.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, '0')} ${period}`;
}

function buildPrompt(
  trip: any,
  groupProfile: string,
  block: InputBlock,
  existingAlternatives: AiBlockAlternative[],
  userPrompt: string | null
): string {
  const count = userPrompt ? 1 : 2;
  const timeDesc = block.start_time
    ? `${formatTime(block.start_time)}${block.end_time ? ` – ${formatTime(block.end_time)}` : ''}`
    : 'untimed';

  const existingContext =
    existingAlternatives.length > 0
      ? `\n\nPreviously suggested alternatives (do NOT repeat these):\n${existingAlternatives
          .map((a, i) => `${i + 1}. ${a.title}${a.location ? ` at ${a.location}` : ''}`)
          .join('\n')}`
      : '';

  const nudge = userPrompt
    ? `\n\nThe planner has a specific request for this replacement: "${userPrompt}"\nGenerate exactly 1 alternative that directly addresses this request.`
    : `\nGenerate exactly 2 distinct alternatives that differ meaningfully from each other and from the original.`;

  return `You are a travel planning assistant helping a group refine their itinerary.

TRIP CONTEXT:
- Destination: ${trip.destination ?? 'unspecified'}
- Dates: ${trip.start_date ?? '?'} to ${trip.end_date ?? '?'}
- Trip type: ${trip.trip_type ?? 'general'}
- Budget: ${trip.budget_per_person ? `~$${trip.budget_per_person} per person` : 'flexible'}

GROUP PROFILE:
${groupProfile}

CURRENT BLOCK TO REPLACE:
- Type: ${block.type}
- Title: ${block.title}
- Time: ${timeDesc}
- Location: ${block.location ?? 'none specified'}
- Notes: ${block.notes ?? 'none'}
- Day: ${block.day_date}${existingContext}${nudge}

RULES:
1. Keep the same time slot (start_time / end_time) unless the user_prompt explicitly asks to change it
2. Keep the same block type unless swapping makes clear sense (e.g. swapping a boring "Lunch" activity for a "meal" type is fine)
3. Be specific — use real place names and concrete activity descriptions relevant to ${trip.destination ?? 'the destination'}
4. Make each alternative genuinely different in character, not just a renamed version of the original
5. reason field should be 1 short sentence explaining why this alternative is a great fit for the group

Respond with ONLY valid JSON — no markdown, no explanation:

{
  "alternatives": [
    {
      "title": "Specific activity or place name",
      "type": "activity|meal|travel|accommodation|free_time",
      "start_time": "HH:MM or null",
      "end_time": "HH:MM or null",
      "location": "Specific place name or null",
      "notes": "Brief tip or detail or null",
      "reason": "One sentence: why this suits the group"
    }
  ]
}`;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
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

    const admin = createClient(supabaseUrl, serviceRoleKey);

    // Auth: user must be a planner for this trip
    const authHeader = req.headers.get('Authorization') ?? '';
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await admin.auth.getUser(token);
    if (authError || !user) return json({ error: 'Unauthorized' }, 401);

    const { trip_id, block, existing_alternatives, user_prompt } = await req.json();
    if (!trip_id) return json({ error: 'trip_id is required' }, 400);
    if (!block) return json({ error: 'block is required' }, 400);

    const { data: trip_member } = await admin
      .from('trip_members')
      .select('role')
      .eq('trip_id', trip_id)
      .eq('user_id', user.id)
      .single();

    if (!trip_member || trip_member.role !== 'planner') {
      return json({ error: 'Only trip planners can request block alternatives' }, 403);
    }

    // Fetch trip details
    const { data: trip, error: tripErr } = await admin
      .from('trips')
      .select('*')
      .eq('id', trip_id)
      .single();

    if (tripErr || !trip) return json({ error: 'Trip not found' }, 404);

    // Fetch confirmed respondents' preferences
    const { data: respondents } = await admin
      .from('respondents')
      .select('preferences')
      .eq('trip_id', trip_id)
      .eq('rsvp', 'in');

    const confirmedCount = (respondents ?? []).length;
    const prefs: RespondentPreferences[] = (respondents ?? [])
      .map((r: any) => r.preferences)
      .filter(Boolean);

    const groupProfile = buildGroupProfile(prefs, confirmedCount);
    const prompt = buildPrompt(
      trip,
      groupProfile,
      block as InputBlock,
      (existing_alternatives ?? []) as AiBlockAlternative[],
      user_prompt ?? null
    );

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.8,
            maxOutputTokens: 4096,
            responseMimeType: 'application/json',
          },
        }),
      }
    );

    if (!geminiRes.ok) {
      const errBody = await geminiRes.text();
      console.error('[suggest-block-alternatives] Gemini error:', geminiRes.status, errBody);
      return json({ error: `Gemini API error: ${geminiRes.status}` }, 500);
    }

    const geminiData = await geminiRes.json();
    const parts = geminiData.candidates?.[0]?.content?.parts ?? [];
    const rawText = parts.find((p: any) => !p.thought)?.text ?? '';

    let alternatives: AiBlockAlternative[] = [];
    try {
      const parsed = JSON.parse(rawText);
      alternatives = Array.isArray(parsed.alternatives) ? parsed.alternatives : [];
    } catch (e) {
      console.error('[suggest-block-alternatives] JSON parse failed:', e, rawText.slice(0, 500));
      return json({ error: 'Failed to parse alternatives from Gemini response' }, 500);
    }

    if (alternatives.length === 0) {
      return json({ error: 'Gemini returned no alternatives' }, 500);
    }

    return json({ alternatives });
  } catch (err) {
    console.error('[suggest-block-alternatives] Unexpected error:', err);
    return json({ error: String(err) }, 500);
  }
});
