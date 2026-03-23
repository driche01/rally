/**
 * Supabase Edge Function — generate-agent-message
 *
 * Generates an AI-crafted SMS/iMessage draft for a specific planner scenario.
 * Stateless — the client decides whether to store the result in agent_nudge_log.
 *
 * Deploy:  supabase functions deploy generate-agent-message
 * Secret:  supabase secrets set GEMINI_API_KEY=AIza...
 *
 * POST body: { trip_id: string, scenario: 'poll_reminder' | 'plan_share' | 'confirmed_group_summary' }
 * Requires: Authorization header with the planner's JWT
 *
 * Returns: { message: string }
 *
 * Scenarios:
 *   poll_reminder         — nudge group to vote on open polls (pre-confirmation)
 *   plan_share            — share confirmed trip details + ask group to RSVP
 *   confirmed_group_summary — kick off a new thread with confirmed group,
 *                            summarise the plan and next steps for booking
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GEMINI_API_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

type Scenario = 'poll_reminder' | 'plan_share' | 'confirmed_group_summary';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { trip_id, scenario } = (await req.json()) as { trip_id: string; scenario: Scenario };
    if (!trip_id || !scenario) {
      return new Response(JSON.stringify({ error: 'trip_id and scenario required' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // ── Fetch trip context ────────────────────────────────────────────────────
    const [tripRes, pollsRes, respondentsRes, lodgingRes, travelRes] = await Promise.all([
      supabase.from('trips').select('*').eq('id', trip_id).single(),
      supabase
        .from('polls')
        .select('id, type, status, poll_options(id, label, vote_count), decided_option_id')
        .eq('trip_id', trip_id),
      supabase.from('respondents').select('id, name, rsvp_status').eq('trip_id', trip_id),
      supabase
        .from('lodging_options')
        .select('title, platform, status, check_in_date, check_out_date, check_in_time, check_out_time, booking_confirmation')
        .eq('trip_id', trip_id),
      supabase
        .from('trip_travel_legs')
        .select('mode, label, departure_date, departure_time, arrival_date, arrival_time, shared_with_group')
        .eq('trip_id', trip_id)
        .is('respondent_id', null),
    ]);

    const trip = tripRes.data;
    if (!trip) {
      return new Response(JSON.stringify({ error: 'Trip not found' }), {
        status: 404,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const polls = pollsRes.data ?? [];
    const respondents = respondentsRes.data ?? [];
    const lodging = lodgingRes.data ?? [];
    const travelLegs = travelRes.data ?? [];

    // ── Build prompt ──────────────────────────────────────────────────────────
    const tripName = trip.name ?? 'the trip';
    const destination = trip.destination ?? null;
    const startDate = trip.start_date ?? null;
    const endDate = trip.end_date ?? null;
    const budget = trip.budget_per_person ?? null;
    const groupSize = trip.group_size_precise ?? null;

    const confirmedNames = respondents
      .filter((r) => r.rsvp_status === 'confirmed')
      .map((r) => r.name);
    const pendingNames = respondents
      .filter((r) => !r.rsvp_status || r.rsvp_status === 'pending')
      .map((r) => r.name);
    const livePolls = polls.filter((p) => p.status === 'live');
    const decidedPolls = polls.filter((p) => p.status === 'decided');

    const bookedLodging = lodging.find((l) => l.status === 'booked');
    const sharedLegs = travelLegs.filter((l) => l.shared_with_group);

    let prompt = '';

    if (scenario === 'poll_reminder') {
      const pollDescriptions = livePolls.map((p) => {
        const type = p.type.replace(/_/g, ' ');
        return `- ${type} poll (${(p.poll_options as {label: string}[])?.map((o) => o.label).join(', ')})`;
      });
      prompt = `
You are writing a friendly, casual group text message on behalf of the trip organizer.

Context:
- Trip name: "${tripName}"
${destination ? `- Destination being considered: ${destination}` : ''}
- There are ${livePolls.length} open poll(s) that need votes:
${pollDescriptions.join('\n')}
${pendingNames.length > 0 ? `- People who haven't voted yet may include: ${pendingNames.join(', ')}` : ''}

Write a short, warm, and slightly fun group text (2-4 sentences) asking everyone to vote on the open polls.
- Don't be pushy — keep it casual and exciting about the trip
- No hashtags, no emojis overload (1-2 max)
- Don't mention the app by name
- Don't use placeholders like [Name] — write as if addressing everyone at once
- Return ONLY the message text, nothing else
`.trim();
    } else if (scenario === 'plan_share') {
      const decidedSummary = decidedPolls.map((p) => {
        const decidedOption = (p.poll_options as {id: string; label: string}[])?.find(
          (o) => o.id === p.decided_option_id
        );
        return `${p.type.replace(/_/g, ' ')}: ${decidedOption?.label ?? 'decided'}`;
      });
      prompt = `
You are writing a friendly, exciting group text message on behalf of the trip organizer announcing that the trip is confirmed.

Context:
- Trip name: "${tripName}"
${destination ? `- Destination: ${destination}` : ''}
${startDate ? `- Dates: ${startDate}${endDate ? ` to ${endDate}` : ''}` : ''}
${groupSize ? `- Group size: ${groupSize} people` : ''}
${budget ? `- Budget: ${budget} per person` : ''}
${decidedSummary.length > 0 ? `- What's been decided:\n${decidedSummary.map((d) => `  - ${d}`).join('\n')}` : ''}
${pendingNames.length > 0 ? `- Still need to confirm they're in: ${pendingNames.join(', ')}` : ''}

Write an enthusiastic but concise group text (3-5 sentences) that:
1. Announces the trip is officially happening
2. Summarises the key confirmed details (destination, dates if known)
3. Asks anyone who hasn't confirmed yet to let the organiser know they're in
- Casual and warm in tone — like a message from a friend
- 1-2 emojis max
- No placeholders like [Name]
- Don't mention the app by name
- Return ONLY the message text, nothing else
`.trim();
    } else if (scenario === 'confirmed_group_summary') {
      const allNames = [
        ...confirmedNames,
        ...respondents.filter((r) => r.rsvp_status !== 'confirmed').map((r) => r.name),
      ];

      const legSummary = sharedLegs.length > 0
        ? sharedLegs.map((l) => {
            const parts = [`${l.mode}: ${l.label}`];
            if (l.departure_date) parts.push(`departs ${l.departure_date}${l.departure_time ? ` at ${l.departure_time}` : ''}`);
            return parts.join(' — ');
          })
        : [];

      const nextSteps: string[] = [];
      if (!bookedLodging) nextSteps.push('confirm lodging');
      if (travelLegs.length === 0) nextSteps.push('sort out travel');
      nextSteps.push('build the itinerary');

      prompt = `
You are writing a message to kick off a new group text thread with the confirmed trip group, sent by the trip organizer.

Context:
- Trip name: "${tripName}"
${destination ? `- Destination: ${destination}` : ''}
${startDate ? `- Dates: ${startDate}${endDate ? ` to ${endDate}` : ''}` : ''}
${groupSize ? `- Group size: ${groupSize} people` : ''}
${budget ? `- Budget: ~${budget} per person` : ''}
${allNames.length > 0 ? `- Group members: ${allNames.join(', ')}` : ''}
${bookedLodging ? `- Lodging confirmed: ${bookedLodging.title} (${bookedLodging.check_in_date ?? ''} – ${bookedLodging.check_out_date ?? ''})` : '- Lodging: not yet confirmed'}
${legSummary.length > 0 ? `- Travel details:\n${legSummary.map((l) => `  - ${l}`).join('\n')}` : '- Travel: not yet added'}
- Next steps: ${nextSteps.join(', ')}

Write an upbeat, friendly opening message for the confirmed group's planning thread (4-6 sentences) that:
1. Welcomes everyone and gets them excited about the trip
2. Recaps the key confirmed details (destination, dates, group)
3. Lists 2-3 clear next steps the group needs to nail down
4. Invites everyone to start sharing their travel plans
- Casual and warm — like a real message from the trip planner
- 2-3 emojis max, placed naturally
- Don't mention the app by name
- No placeholders like [Name]
- Return ONLY the message text, nothing else
`.trim();
    } else {
      return new Response(JSON.stringify({ error: 'Unknown scenario' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // ── Call Gemini ───────────────────────────────────────────────────────────
    const geminiKey = Deno.env.get('GEMINI_API_KEY');
    if (!geminiKey) {
      return new Response(JSON.stringify({ error: 'GEMINI_API_KEY not configured' }), {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const geminiRes = await fetch(`${GEMINI_API_URL}?key=${geminiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.8,
          maxOutputTokens: 1024,
        },
      }),
    });

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error('Gemini error:', errText);
      return new Response(JSON.stringify({ error: 'AI generation failed' }), {
        status: 502,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const geminiData = await geminiRes.json();
    const responseParts = geminiData.candidates?.[0]?.content?.parts ?? [];
    const message = (responseParts.find((p: { thought?: boolean; text?: string }) => !p.thought)?.text ?? '').trim();

    if (!message) {
      return new Response(JSON.stringify({ error: 'Empty response from AI' }), {
        status: 502,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ message }), {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('generate-agent-message error:', err);
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
});
