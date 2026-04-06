/**
 * Component 8: BotResponseGenerator
 *
 * Wraps Claude API calls for all non-poll SMS agent messages:
 * introductions, phase transitions, confirmations, celebrations.
 *
 * Two modes:
 *   - Standard: phase-aware conversational responses
 *   - Celebration: tone-matched milestone messages
 */
import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { TripSession, TripSessionParticipant } from './trip-session.ts';

// ─── Prompt serialization (keep under 2000 tokens) ──────────────────────────

function serializeForPrompt(
  session: TripSession,
  participants: TripSessionParticipant[],
  phase: string,
): Record<string, unknown> {
  const planner = participants.find((p) => p.is_planner);
  const base: Record<string, unknown> = {
    destination: session.destination,
    dates: session.dates,
    phase,
    budget_median: session.budget_median,
    budget_status: session.budget_status,
    planner_name: planner?.display_name ?? 'the planner',
    participant_names: participants.map((p) => p.display_name).filter(Boolean),
    thread_name: session.thread_name,
  };

  const phaseFields: Record<string, Record<string, unknown>> = {
    COLLECTING_DESTINATIONS: {
      destination_candidates: (session as Record<string, unknown>).destination_candidates,
    },
    DECIDING_DESTINATION: {
      destination_candidates: (session as Record<string, unknown>).destination_candidates,
      budget_range: (session as Record<string, unknown>).budget_range,
    },
    AWAITING_FLIGHTS: {
      committed_count: ((session as Record<string, unknown>).committed_participants as unknown[] | null)?.length,
    },
    DECIDING_LODGING_TYPE: {
      lodging_cost: (session as Record<string, unknown>).lodging_cost,
      lodging_property: session.lodging_property,
    },
    FIRST_BOOKING_REACHED: {
      lodging_property: session.lodging_property,
      lodging_type: (session as Record<string, unknown>).lodging_type,
    },
  };

  return { ...base, ...(phaseFields[phase] || {}) };
}

// ─── Tone profiling ─────────────────────────────────────────────────────────

interface ToneProfile {
  energy: 'high' | 'low';
  formality: 'casual' | 'neutral';
}

function profileTone(messages: { body: string }[]): ToneProfile {
  if (messages.length === 0) return { energy: 'low', formality: 'neutral' };

  let exclamations = 0;
  let capsWords = 0;
  let emojiCount = 0;
  let totalLength = 0;
  let slangCount = 0;

  const slangPatterns = /\b(lol|omg|tbh|ngl|fr|bruh|lmao|haha|yoo|lets gooo|yesss|nooo)\b/gi;
  const emojiPattern = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu;

  for (const m of messages) {
    const body = m.body ?? '';
    exclamations += (body.match(/!/g) || []).length;
    capsWords += (body.match(/\b[A-Z]{2,}\b/g) || []).length;
    emojiCount += (body.match(emojiPattern) || []).length;
    totalLength += body.length;
    slangCount += (body.match(slangPatterns) || []).length;
  }

  const avgLen = totalLength / messages.length;
  const energyScore = exclamations + capsWords * 2 + emojiCount;
  const energy: 'high' | 'low' = energyScore > messages.length * 1.5 ? 'high' : 'low';
  const formality: 'casual' | 'neutral' = slangCount > messages.length * 0.3 || avgLen < 30 ? 'casual' : 'neutral';

  return { energy, formality };
}

// ─── System prompt ───────────────────────────────────────────────────────────

const PERSONA_PROMPT = `You are Rally, an SMS trip planning assistant in a group text thread.

Personality:
- You're the best project manager and best friend rolled into one
- Efficient without being robotic, warm without being sappy, fun without being annoying
- You get to the point fast, match the group's energy, and move things forward
- You sound like the most competent, fun friend in the group — never like a chatbot

Message constraints:
- Plain text only — no markdown, no bold, no bullet points, no asterisks
- Use line breaks freely for readability
- Keep most messages under 300 characters
- Lists use numbers on separate lines
- Every cost figure includes "per person" or "total" explicitly
- No filler phrases like "Great!" or "Sure thing!" or "Absolutely!"`;

// ─── Standard mode ───────────────────────────────────────────────────────────

/**
 * Generate a standard conversational response.
 */
export async function generateResponse(
  admin: SupabaseClient,
  session: TripSession,
  participants: TripSessionParticipant[],
  context: string,
): Promise<string | null> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) {
    console.error('[bot-response] ANTHROPIC_API_KEY not set');
    return null;
  }

  const sessionContext = serializeForPrompt(session, participants, session.phase);

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 400,
        system: PERSONA_PROMPT,
        messages: [
          {
            role: 'user',
            content: `Session state:\n${JSON.stringify(sessionContext, null, 2)}\n\nParticipants: ${participants.map((p) => p.display_name ?? p.phone).join(', ')}\n\nTask: ${context}\n\nGenerate a single SMS message. Plain text only, under 300 characters.`,
          },
        ],
      }),
    });

    // #76 — Claude API 500/error: graceful degradation to templated fallback
    if (!response.ok) {
      console.error('[bot-response] Sonnet API error:', response.status);
      return generateFallback(context);
    }

    const result = await response.json();
    const raw = result.content?.[0]?.text ?? null;
    if (!raw) return generateFallback(context);
    let text = stripAiDisclaimer(raw, context);
    // Enforce 320 char SMS limit
    if (text.length > 320) {
      const truncated = text.slice(0, 320);
      const lastBreak = Math.max(truncated.lastIndexOf('. '), truncated.lastIndexOf('! '), truncated.lastIndexOf('\n'));
      text = lastBreak > 100 ? truncated.slice(0, lastBreak + 1) : truncated.slice(0, truncated.lastIndexOf(' '));
    }
    return text;
  } catch (err) {
    console.error('[bot-response] Error calling Sonnet:', err);
    return generateFallback(context);
  }
}

// ─── Celebration mode ────────────────────────────────────────────────────────

export type Milestone =
  | 'destination_locked'
  | 'group_committed'
  | 'flights_updated'
  | 'lodging_confirmed';

/**
 * Generate a tone-matched celebration message for a milestone.
 */
export async function generateCelebration(
  admin: SupabaseClient,
  session: TripSession,
  participants: TripSessionParticipant[],
  milestone: Milestone,
  milestoneDetail: string,
): Promise<string> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return getCelebrationFallback(milestone, milestoneDetail);

  // Get recent messages for tone profiling
  const { data: recentMessages } = await admin
    .from('thread_messages')
    .select('body')
    .eq('trip_session_id', session.id)
    .neq('sender_role', 'rally')
    .order('created_at', { ascending: false })
    .limit(10);

  const tone = profileTone(recentMessages ?? []);

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 200,
        system: PERSONA_PROMPT,
        messages: [
          {
            role: 'user',
            content: `Generate a single celebratory message for this milestone: ${milestoneDetail}.\n\nThe group's tone is ${tone.energy} energy and ${tone.formality}. Match their style exactly — sound like you've been in this thread the whole time. Reference the milestone concretely. Emoji are allowed. Max 320 characters. Plain text only.`,
          },
        ],
      }),
    });

    if (!response.ok) return getCelebrationFallback(milestone, milestoneDetail);

    const result = await response.json();
    let text = result.content?.[0]?.text ?? getCelebrationFallback(milestone, milestoneDetail);
    // Enforce 320 char SMS limit — truncate at last complete sentence/word
    if (text.length > 320) {
      const truncated = text.slice(0, 320);
      const lastBreak = Math.max(truncated.lastIndexOf('. '), truncated.lastIndexOf('! '), truncated.lastIndexOf('\n'));
      text = lastBreak > 100 ? truncated.slice(0, lastBreak + 1) : truncated.slice(0, truncated.lastIndexOf(' '));
    }
    return text;
  } catch {
    return getCelebrationFallback(milestone, milestoneDetail);
  }
}

// ─── AI disclaimer filter (#86) ─────────────────────────────────────────────

function stripAiDisclaimer(text: string, context: string): string {
  if (/^(As an AI|I'm an AI|As a language model)/i.test(text.trim())) {
    // Strip the first sentence
    const rest = text.replace(/^[^.!?]*[.!?]\s*/, '').trim();
    return rest.length > 0 ? rest : generateFallback(context);
  }
  return text;
}

// ─── Graceful degradation (API down fallbacks) ───────────────────────────────

function generateFallback(context: string): string {
  if (context.includes('status') || context.includes('STATUS')) {
    return 'Working on getting your status — give me a moment.';
  }
  return 'Got it \u2014 give me a moment.';
}

function getCelebrationFallback(milestone: Milestone, detail: string): string {
  switch (milestone) {
    case 'destination_locked':
      return `${detail} is locked in! \u{1F389} Who's in?`;
    case 'group_committed':
      return `The crew is confirmed \u2014 let's plan the rest!`;
    case 'flights_updated':
      return `Flights update is in \u2014 getting closer! \u2708\uFE0F`;
    case 'lodging_confirmed':
      return `You're booked! \u{1F389} First booking is locked.`;
    default:
      return `Milestone hit \u2014 nice work! \u{1F389}`;
  }
}

// ─── Hype cooldown scheduling ────────────────────────────────────────────────

/**
 * Enter celebration mode: set sub_state and schedule cooldown actions.
 */
export async function enterCelebrationMode(
  admin: SupabaseClient,
  session: TripSession,
): Promise<void> {
  const now = new Date();

  await admin
    .from('trip_sessions')
    .update({
      phase_sub_state: 'CELEBRATING',
      celebration_started_at: now.toISOString(),
      updated_at: now.toISOString(),
    })
    .eq('id', session.id);

  // Schedule silence check at 90s
  await admin.from('scheduled_actions').insert({
    trip_session_id: session.id,
    action_type: 'hype_cooldown_silence',
    execute_at: new Date(now.getTime() + 90_000).toISOString(),
  });

  // Schedule hard cap at 5m
  await admin.from('scheduled_actions').insert({
    trip_session_id: session.id,
    action_type: 'hype_cooldown_cap',
    execute_at: new Date(now.getTime() + 300_000).toISOString(),
  });
}
