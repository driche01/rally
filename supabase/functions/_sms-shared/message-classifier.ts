/**
 * MessageClassifier
 *
 * Single Haiku call that categorizes an inbound message into one of:
 *   - trip_decision : on-topic contribution to the current phase's decision
 *                     (destination, dates, budget, commit, flight status, lodging, etc.)
 *   - opt_out       : user is gracefully removing themselves
 *                     ("I'm out", "can't make it", "have to bow out")
 *   - reaction      : emotional/social reaction with no content
 *                     ("omg", "noooo", "lol", "bless you", "thanks for planning")
 *   - peer_chat     : on-topic-adjacent chatter between humans, not for Rally
 *                     (groceries, property questions, personal stories, gossip,
 *                      third-party status reports, asterisk corrections)
 *   - noise         : off-topic, system notifications, pasted AI output,
 *                     forwarded content not meant for the group decision
 *   - unknown       : classifier failed or genuinely ambiguous — fall through
 *                     to existing phase logic (safe default)
 *
 * Replaces the ~300 lines of scattered regex silence filters in message-router.ts.
 *
 * Fast-path regex still runs BEFORE this classifier for the ~60% of noise that
 * is obvious (iMessage reactions, "unsent", emoji-only, bare "*correction").
 * Everything past the fast path calls Haiku.
 */
import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { TripSession, TripSessionParticipant } from './trip-session.ts';

export type MessageCategory =
  | 'trip_decision'
  | 'opt_out'
  | 'reaction'
  | 'peer_chat'
  | 'noise'
  | 'unknown';

export interface Classification {
  category: MessageCategory;
  confidence: number; // 0..1, 0 when unknown
  reason?: string;
}

const UNKNOWN: Classification = { category: 'unknown', confidence: 0 };

// ─── Fast-path regex (cheap obvious noise, no LLM call) ─────────────────────

/**
 * Returns a Classification if the message is obviously classifiable without an LLM,
 * or null if it needs the Haiku call.
 */
export function fastPathClassify(body: string): Classification | null {
  const trimmed = body.trim();
  if (trimmed.length === 0) return { category: 'noise', confidence: 1 };

  // iMessage reaction forwarded as SMS
  if (/^(?:reacted\s+\S+\s+to\s+["']|liked\s+["']|loved\s+["']|emphasized\s+["']|laughed\s+at\s+["']|questioned\s+["']|disliked\s+["'])/i.test(trimmed)) {
    return { category: 'reaction', confidence: 1, reason: 'imessage_reaction' };
  }

  // "You unsent a message" system notice
  if (/^(?:you|[\w\s]+)\s+unsent\s+a\s+message$/i.test(trimmed)) {
    return { category: 'noise', confidence: 1, reason: 'unsent_notice' };
  }

  // Emoji-only (no alphanumerics after stripping pictographs + whitespace)
  const stripped = trimmed.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}\s\u200d\ufe0f]/gu, '');
  if (stripped.length === 0) {
    return { category: 'reaction', confidence: 1, reason: 'emoji_only' };
  }

  // Asterisk correction ("*four including me")
  if (/^\*\S/.test(trimmed)) {
    return { category: 'peer_chat', confidence: 1, reason: 'asterisk_correction' };
  }

  // Bare exclamation words with optional repetition / punctuation
  if (/^(?:lol+|haha+|hehe+|omg+|ugh+|oof+|oo+f+|yikes+|rip+|damn+|wow+|bruh+|sheesh+|aye+|ayy+|no+o+|nooo+|oh\s*no+)!*\??$/i.test(trimmed)) {
    return { category: 'reaction', confidence: 1, reason: 'bare_exclamation' };
  }

  // Bare farewell
  if (/^(?:bye+\s*(?:guys+|everyone|y'?all|all)?!*|see\s+y(?:ou|a)|later+!*|peace+!*)$/i.test(trimmed)) {
    return { category: 'reaction', confidence: 1, reason: 'farewell' };
  }

  return null;
}

// ─── Haiku classifier ────────────────────────────────────────────────────────

interface ClassifierContext {
  admin: SupabaseClient;
  session: TripSession;
  participants: TripSessionParticipant[];
  body: string;
}

/**
 * Classify an inbound message. Runs the fast-path first; falls back to Haiku
 * for anything non-obvious. On any error returns { category: 'unknown' } so
 * the caller falls through to existing phase logic.
 */
export async function classifyMessage(ctx: ClassifierContext): Promise<Classification> {
  const fast = fastPathClassify(ctx.body);
  if (fast) return fast;

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) {
    console.error('[message-classifier] ANTHROPIC_API_KEY not set');
    return UNKNOWN;
  }

  // Pull recent thread context (last 10 non-Rally messages)
  const { data: recent } = await ctx.admin
    .from('thread_messages')
    .select('sender_phone, sender_role, body, created_at')
    .eq('trip_session_id', ctx.session.id)
    .neq('sender_role', 'rally')
    .order('created_at', { ascending: false })
    .limit(10);

  const nameMap = new Map<string, string>();
  for (const p of ctx.participants) nameMap.set(p.phone, p.display_name ?? p.phone);

  const history = (recent ?? [])
    .reverse()
    .map((m) => `${nameMap.get(m.sender_phone) ?? m.sender_phone}: ${m.body}`)
    .join('\n');

  const prompt = buildPrompt(ctx.session.phase, history, ctx.body);

  // 4 second budget — Supabase edge functions have a hard timeout and we
  // don't want a slow Haiku response to 502 the whole webhook.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  let response: Response;
  try {
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 128,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    console.error('[message-classifier] fetch failed', err);
    return UNKNOWN;
  }
  clearTimeout(timer);
  try {

    if (!response.ok) {
      console.error('[message-classifier] Haiku error', response.status);
      return UNKNOWN;
    }

    const result = await response.json();
    const text = (result.content?.[0]?.text ?? '').trim();
    return parseResponse(text);
  } catch (err) {
    console.error('[message-classifier] fetch failed', err);
    return UNKNOWN;
  }
}

// ─── Prompt ─────────────────────────────────────────────────────────────────

function buildPrompt(phase: string, history: string, latest: string): string {
  return `You are a classifier for a group-trip-planning SMS bot called Rally.

Rally is in phase: ${phase}
Recent thread (oldest → newest):
${history || '(no prior messages)'}

NEW MESSAGE to classify:
"${latest}"

Classify the NEW MESSAGE into exactly ONE category:

- trip_decision: a substantive contribution toward the current trip decision
  (proposing/agreeing to a destination, dates, budget, committing to go,
  confirming flights booked, choosing lodging type, etc.)
- opt_out: the sender is removing themselves from the trip
  ("I'm out", "can't make it", "have to bow out", "count me out",
  "won't be able to make it", "sadly out"). NOT just "I'm out of town this weekend".
- reaction: emotional or social reaction with no decision content
  ("omg", "nooo", "lol", "bless you", "thanks for planning", "you're the best")
- peer_chat: on-topic-adjacent chatter between humans not addressed to Rally
  (groceries, property/wifi questions, personal stories, third-party status
  reports like "Michelle is a TBD", gossip, asterisk corrections)
- noise: off-topic, system notifications, pasted AI output, album alerts,
  protest updates, anything unrelated to planning this trip

Respond with ONLY a single JSON object, no prose:
{"category":"<one of above>","confidence":<0.0-1.0>}

If genuinely ambiguous, prefer "trip_decision" so Rally stays engaged.`;
}

// ─── Response parser ────────────────────────────────────────────────────────

function parseResponse(text: string): Classification {
  const match = text.match(/\{[^}]*"category"[^}]*\}/);
  if (!match) return UNKNOWN;
  try {
    const parsed = JSON.parse(match[0]);
    const category = parsed.category as MessageCategory;
    const valid: MessageCategory[] = ['trip_decision', 'opt_out', 'reaction', 'peer_chat', 'noise'];
    if (!valid.includes(category)) return UNKNOWN;
    const confidence = typeof parsed.confidence === 'number'
      ? Math.max(0, Math.min(1, parsed.confidence))
      : 0.5;
    return { category, confidence };
  } catch {
    return UNKNOWN;
  }
}
