/**
 * Component 5: ConversationParser
 *
 * Extracts organic decisions from group conversation using Claude Haiku.
 * Runs at two moments:
 *   1. Pre-poll check — before PollEngine fires, to skip already-decided polls
 *   2. During active collect phases — on every inbound message, to close early
 *
 * Uses a pre-filter to skip cheap messages that can't contain decisions.
 * Filters out Rally's own messages to prevent feedback loops.
 */
import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { TripSession, TripSessionParticipant } from './trip-session.ts';

// ─── Phase → decision whitelist ──────────────────────────────────────────────

const PHASE_DECISIONS: Record<string, string[]> = {
  COLLECTING_DESTINATIONS: ['destination_candidates'],
  DECIDING_DATES: ['dates'],
  BUDGET_POLL: ['budget_per_person'],
  DECIDING_DESTINATION: ['destination'],
  COMMIT_POLL: ['committed_status_per_participant'],
  AWAITING_FLIGHTS: ['flight_status_per_participant'],
  DECIDING_LODGING_TYPE: ['lodging_type'],
  AWAITING_GROUP_BOOKING: ['lodging_property', 'lodging_cost'],
};

// ─── Pre-filter ──────────────────────────────────────────────────────────────

/**
 * Returns true if the message should SKIP ConversationParser (too cheap).
 */
export function shouldSkipParsing(body: string): boolean {
  const trimmed = body.trim();

  // 3 words or fewer
  if (trimmed.split(/\s+/).length <= 3) return true;

  // Emoji-only (no alphabetic characters)
  if (!/[a-zA-Z]/.test(trimmed)) return true;

  // Single digit matching poll option
  if (/^\d$/.test(trimmed)) return true;

  return false;
}

// ─── Context summary (deterministic, no LLM) ────────────────────────────────

export function buildContextSummary(
  session: TripSession,
  participants: TripSessionParticipant[],
): string {
  const parts: string[] = [];
  if (session.destination) parts.push(`Destination: ${session.destination}`);
  if (session.dates?.start) parts.push(`Dates: ${session.dates.start}–${session.dates.end}`);
  if (session.budget_median) parts.push(`Budget: ~$${session.budget_median}/person`);
  const committed = participants.filter((p) => p.committed === true).length;
  if (committed > 0) parts.push(`${committed} confirmed going`);
  if (session.lodging_property) parts.push(`Lodging: ${session.lodging_property}`);
  return parts.length ? parts.join('. ') + '.' : 'No decisions locked yet.';
}

// ─── Main parser ─────────────────────────────────────────────────────────────

export interface ParsedDecisions {
  destination_candidates?: string[];
  destination?: string;
  dates?: { start: string; end: string };
  budget_per_person?: number;
  lodging_type?: string;
  lodging_property?: string;
  lodging_cost?: number;
  committed_status_per_participant?: Record<string, boolean>;
  flight_status_per_participant?: Record<string, string>;
}

/**
 * Run ConversationParser on the current session + recent messages.
 * Returns extracted decisions (non-null values only), or null if nothing found.
 */
export async function parseConversation(
  admin: SupabaseClient,
  session: TripSession,
  participants: TripSessionParticipant[],
  inboundBody: string,
): Promise<ParsedDecisions | null> {
  const phase = session.phase;
  const openDecisions = PHASE_DECISIONS[phase];

  // No decisions to monitor in this phase
  if (!openDecisions || openDecisions.length === 0) return null;

  // Pre-filter cheap messages
  if (shouldSkipParsing(inboundBody)) return null;

  // Fetch recent human-only messages (filter out Rally's)
  const { data: recentMessages } = await admin
    .from('thread_messages')
    .select('sender_phone, sender_role, body')
    .eq('trip_session_id', session.id)
    .neq('sender_role', 'rally')
    .order('created_at', { ascending: false })
    .limit(30);

  if (!recentMessages || recentMessages.length === 0) return null;

  // Build participant name map for the prompt
  const nameMap = new Map<string, string>();
  for (const p of participants) {
    nameMap.set(p.phone, p.display_name ?? p.phone);
  }

  const contextSummary = buildContextSummary(session, participants);
  const history = recentMessages
    .reverse()
    .map((m) => `${nameMap.get(m.sender_phone) ?? m.sender_phone}: ${m.body}`)
    .join('\n');

  // Build the extraction prompt
  const prompt = buildPrompt(phase, openDecisions, contextSummary, history, inboundBody, participants);

  // Call Claude Haiku
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) {
    console.error('[conversation-parser] ANTHROPIC_API_KEY not set');
    return null;
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 512,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      console.error('[conversation-parser] Haiku API error:', response.status);
      return null;
    }

    const result = await response.json();
    const text = result.content?.[0]?.text ?? '';

    return parseHaikuResponse(text, openDecisions);
  } catch (err) {
    console.error('[conversation-parser] Error calling Haiku:', err);
    return null;
  }
}

// ─── Prompt builder ──────────────────────────────────────────────────────────

function buildPrompt(
  phase: string,
  openDecisions: string[],
  contextSummary: string,
  history: string,
  latestMessage: string,
  participants: TripSessionParticipant[],
): string {
  const participantCount = participants.filter((p) => p.status === 'active').length;

  let extraInstructions = '';

  // Flight status has looser extraction rules (binary individual action)
  if (phase === 'AWAITING_FLIGHTS') {
    extraInstructions = `
Flight status extraction rules (looser than group decisions):
- Treat as "confirmed": "I booked", "booked my flight", "just booked", "done", "sorted", "got mine", "✈️", booking URLs shared
- Treat as "not_yet": "gonna book tonight", "booking tomorrow", "planning to book", "will do it soon"
- Treat as "unknown": "thinking about it", "not sure yet", "depends", no response
- Treat as "driving": "driving", "road trip", "not flying"
Return flight_status_per_participant as { "phone": "status" } for any participant whose status you can determine.`;
  }

  // Group decisions need quorum
  if (['COLLECTING_DESTINATIONS', 'DECIDING_DATES', 'BUDGET_POLL', 'DECIDING_DESTINATION', 'DECIDING_LODGING_TYPE'].includes(phase)) {
    extraInstructions += `
Consensus rules for group decisions:
- A value must be mentioned positively by 50%+ of participants who have sent any message
- At least one DIFFERENT participant must explicitly agree ("yes", "that works", "+1", "agreed", "same")
- No unresolved objections ("actually I was thinking...", "wait but...", "what about...")
- If fewer than 3 unique participants have weighed in, return null regardless
- One person suggesting + one agreeing is NOT consensus when others haven't spoken`;
  }

  return `You are reading a group trip planning text thread. The group still needs to decide: ${openDecisions.join(', ')}.

Context summary: ${contextSummary}
Active participants: ${participantCount}

Thread (last 30 human messages only):
${history}

Latest message: "${latestMessage}"
${extraInstructions}

Has the group already clearly agreed on any of the open decisions above?
Return ONLY a JSON object. For each decision, set the value if clearly agreed, or null if still open or ambiguous.
Example: { "destination": "Tulum", "budget_per_person": null, "lodging_type": "group rental" }
If nothing is decided, return all nulls. Do not infer — only extract explicit agreement.`;
}

// ─── Response parser ─────────────────────────────────────────────────────────

function parseHaikuResponse(
  raw: string,
  openDecisions: string[],
): ParsedDecisions | null {
  try {
    // Strip markdown fences if present
    const stripped = raw
      .trim()
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    const parsed = JSON.parse(stripped);

    // Filter to only open decisions with non-null values
    const result: ParsedDecisions = {};
    let hasValue = false;

    for (const key of openDecisions) {
      if (parsed[key] !== null && parsed[key] !== undefined) {
        (result as Record<string, unknown>)[key] = parsed[key];
        hasValue = true;
      }
    }

    return hasValue ? result : null;
  } catch {
    console.error('[conversation-parser] Failed to parse Haiku response:', raw.slice(0, 200));
    return null;
  }
}

// ─── Decision applier ────────────────────────────────────────────────────────

/**
 * Apply parsed decisions to the trip session.
 * Only writes values that are not already set (no overwrite of locked decisions).
 * Returns list of fields that were updated.
 */
export async function applyDecisions(
  admin: SupabaseClient,
  session: TripSession,
  decisions: ParsedDecisions,
): Promise<string[]> {
  const updates: Record<string, unknown> = {};
  const applied: string[] = [];

  if (decisions.destination && !session.destination) {
    updates.destination = decisions.destination;
    applied.push('destination');
  }

  if (decisions.dates && !session.dates) {
    updates.dates = decisions.dates;
    applied.push('dates');
  }

  if (decisions.budget_per_person && !session.budget_median) {
    updates.budget_median = decisions.budget_per_person;
    updates.budget_status = 'ALIGNED';
    applied.push('budget_per_person');
  }

  if (decisions.lodging_type && !(session as Record<string, unknown>).lodging_type) {
    updates.lodging_type = decisions.lodging_type;
    applied.push('lodging_type');
  }

  if (decisions.lodging_property && !session.lodging_property) {
    updates.lodging_property = decisions.lodging_property;
    applied.push('lodging_property');
  }

  if (decisions.lodging_cost && !(session as Record<string, unknown>).lodging_cost) {
    updates.lodging_cost = decisions.lodging_cost;
    applied.push('lodging_cost');
  }

  // Destination candidates — append to existing list
  if (decisions.destination_candidates) {
    const existing = (session as Record<string, unknown>).destination_candidates as Array<{ label: string }> ?? [];
    const existingLabels = new Set(existing.map((c) => c.label.toLowerCase()));
    const newCandidates = decisions.destination_candidates
      .filter((c) => !existingLabels.has(c.toLowerCase()))
      .map((label) => ({ label, votes: 0 }));
    if (newCandidates.length > 0) {
      updates.destination_candidates = [...existing, ...newCandidates];
      applied.push('destination_candidates');
    }
  }

  // Flight status — update per participant
  if (decisions.flight_status_per_participant) {
    for (const [phone, status] of Object.entries(decisions.flight_status_per_participant)) {
      if (['confirmed', 'not_yet', 'unknown', 'driving'].includes(status)) {
        await admin
          .from('trip_session_participants')
          .update({ flight_status: status })
          .eq('trip_session_id', session.id)
          .eq('phone', phone);
      }
    }
    applied.push('flight_status');
  }

  // Committed status — update per participant
  if (decisions.committed_status_per_participant) {
    for (const [phone, committed] of Object.entries(decisions.committed_status_per_participant)) {
      await admin
        .from('trip_session_participants')
        .update({ committed })
        .eq('trip_session_id', session.id)
        .eq('phone', phone);
    }
    applied.push('committed_status');
  }

  // Apply session-level updates
  if (Object.keys(updates).length > 0) {
    updates.updated_at = new Date().toISOString();
    await admin.from('trip_sessions').update(updates).eq('id', session.id);
  }

  return applied;
}
