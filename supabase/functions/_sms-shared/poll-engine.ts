/**
 * Component 6: PollEngine
 *
 * Handles all structured collection flows:
 *   - Standard vote mode (destinations, dates, lodging, commit)
 *   - Budget mode (optional, with normalization + dispute detection)
 *
 * Writes to the unified polls / poll_options / poll_responses tables
 * so both SMS and web/app see the same data.
 *
 * One collection flow at a time (strict serialization).
 */
import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { TripSession, TripSessionParticipant } from './trip-session.ts';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface Poll {
  id: string;
  trip_id: string;
  trip_session_id: string;
  type: string;
  title: string;
  status: string;
  phase: string;
  winner: string | null;
  opened_at: string;
  closed_at: string | null;
}

export interface PollOption {
  id: string;
  poll_id: string;
  label: string;
  position: number;
}

// ─── Budget normalization ────────────────────────────────────────────────────

const BUDGET_TIER_MAP: Record<string, number> = {
  '1': 250,
  '2': 750,
  '3': 1500,
  '4': 2500,
};

/**
 * Normalize a budget response to a dollar amount.
 * Accepts: "1"-"4" (tiers), "SKIP", or a raw dollar amount.
 */
export function normalizeBudget(raw: string): { amount: number | null; skipped: boolean } {
  const trimmed = raw.trim().toUpperCase();

  if (trimmed === 'SKIP') return { amount: null, skipped: true };

  // Strip trailing punctuation (handles "3.", "2!", etc.)
  const cleaned = trimmed.replace(/[.\s!]+$/, '');

  // Tier number (1-4)
  if (BUDGET_TIER_MAP[cleaned]) return { amount: BUDGET_TIER_MAP[cleaned], skipped: false };

  // Raw dollar amount: strip $, commas
  const parsed = parseFloat(cleaned.replace(/[$,]/g, ''));
  if (!isNaN(parsed) && parsed > 0) {
    // If someone typed just "3" or "4" without $, it's a tier not $3
    if (BUDGET_TIER_MAP[String(parsed)]) return { amount: BUDGET_TIER_MAP[String(parsed)], skipped: false };
    return { amount: parsed, skipped: false };
  }

  return { amount: null, skipped: false };
}

// ─── Poll CRUD ───────────────────────────────────────────────────────────────

/**
 * Get the currently open poll for a session.
 */
export async function getOpenPoll(
  admin: SupabaseClient,
  sessionId: string,
): Promise<Poll | null> {
  const { data } = await admin
    .from('polls')
    .select('*')
    .eq('trip_session_id', sessionId)
    .in('status', ['live', 'open'])
    .order('opened_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return data;
}

/**
 * Create a new poll with options.
 * Sets it as the current poll on the session.
 */
export async function createPoll(
  admin: SupabaseClient,
  session: TripSession,
  pollType: string,
  title: string,
  optionLabels: string[],
): Promise<{ poll: Poll; options: PollOption[] }> {
  const now = new Date().toISOString();

  // Create poll row (unified table — both SMS and app see it)
  const { data: poll, error: pollErr } = await admin
    .from('polls')
    .insert({
      trip_id: session.trip_id,
      trip_session_id: session.id,
      type: pollType,
      title,
      status: 'live',
      phase: session.phase,
      opened_at: now,
      allow_multi_select: false,
      position: 0,
    })
    .select('*')
    .single();

  if (pollErr) throw new Error(`Failed to create poll: ${pollErr.message}`);

  // Create option rows
  const optionInserts = optionLabels.map((label, i) => ({
    poll_id: poll!.id,
    label,
    position: i,
  }));

  const { data: options, error: optErr } = await admin
    .from('poll_options')
    .insert(optionInserts)
    .select('*');

  if (optErr) throw new Error(`Failed to create poll options: ${optErr.message}`);

  // Set as current poll on session
  await admin
    .from('trip_sessions')
    .update({ current_poll_id: poll!.id, updated_at: now })
    .eq('id', session.id);

  return { poll: poll!, options: options! };
}

/**
 * Record a vote from a participant.
 * Deduplicates: one response per participant per poll.
 */
export async function recordVote(
  admin: SupabaseClient,
  poll: Poll,
  respondentId: string,
  optionId: string,
): Promise<boolean> {
  // Check for existing response
  const { data: existing } = await admin
    .from('poll_responses')
    .select('id')
    .eq('poll_id', poll.id)
    .eq('respondent_id', respondentId)
    .maybeSingle();

  if (existing) {
    // Update existing vote
    await admin
      .from('poll_responses')
      .update({ option_id: optionId, channel: 'sms' })
      .eq('id', existing.id);
  } else {
    // New vote
    await admin.from('poll_responses').insert({
      poll_id: poll.id,
      respondent_id: respondentId,
      option_id: optionId,
      channel: 'sms',
    });
  }

  return true;
}

/**
 * Get all responses for a poll with option labels.
 */
export async function getPollResults(
  admin: SupabaseClient,
  pollId: string,
): Promise<{ optionId: string; label: string; count: number }[]> {
  const { data: options } = await admin
    .from('poll_options')
    .select('id, label')
    .eq('poll_id', pollId)
    .order('position');

  if (!options) return [];

  const { data: responses } = await admin
    .from('poll_responses')
    .select('option_id')
    .eq('poll_id', pollId);

  const counts = new Map<string, number>();
  for (const r of responses ?? []) {
    counts.set(r.option_id, (counts.get(r.option_id) ?? 0) + 1);
  }

  return options.map((o) => ({
    optionId: o.id,
    label: o.label,
    count: counts.get(o.id) ?? 0,
  }));
}

/**
 * Close a poll, declare winner, and clear it from the session.
 */
export async function closePoll(
  admin: SupabaseClient,
  session: TripSession,
  pollId: string,
  winner: string | null,
): Promise<void> {
  const now = new Date().toISOString();

  await admin
    .from('polls')
    .update({
      status: 'decided',
      winner,
      closed_at: now,
    })
    .eq('id', pollId);

  // If winner matches a poll_option, set decided_option_id too (for app compatibility)
  if (winner) {
    const { data: winnerOption } = await admin
      .from('poll_options')
      .select('id')
      .eq('poll_id', pollId)
      .eq('label', winner)
      .maybeSingle();

    if (winnerOption) {
      await admin
        .from('polls')
        .update({ decided_option_id: winnerOption.id })
        .eq('id', pollId);
    }
  }

  // Clear current_poll_id on session
  await admin
    .from('trip_sessions')
    .update({ current_poll_id: null, updated_at: now })
    .eq('id', session.id);
}

// ─── Vote resolution ─────────────────────────────────────────────────────────

/**
 * Check if all expected participants have voted.
 */
export async function allVotesIn(
  admin: SupabaseClient,
  pollId: string,
  expectedCount: number,
): Promise<boolean> {
  const { count } = await admin
    .from('poll_responses')
    .select('id', { count: 'exact', head: true })
    .eq('poll_id', pollId);

  return (count ?? 0) >= expectedCount;
}

/**
 * Determine the winner from poll results.
 * Handles ties with coin flip.
 */
export function resolveWinner(
  results: { optionId: string; label: string; count: number }[],
): { winner: string; tied: boolean } {
  if (results.length === 0) return { winner: '', tied: false };

  const maxCount = Math.max(...results.map((r) => r.count));
  const leaders = results.filter((r) => r.count === maxCount);

  if (leaders.length === 1) {
    return { winner: leaders[0].label, tied: false };
  }

  // Tie — coin flip
  const randomIndex = Math.floor(Math.random() * leaders.length);
  return { winner: leaders[randomIndex].label, tied: true };
}

// ─── Budget alignment check ──────────────────────────────────────────────────

export interface BudgetAnalysis {
  median: number;
  low: number;
  high: number;
  aligned: boolean; // high/low <= 2.0
  spreadRatio: number;
}

export function analyzeBudget(amounts: number[]): BudgetAnalysis {
  if (amounts.length === 0) {
    return { median: 0, low: 0, high: 0, aligned: true, spreadRatio: 0 };
  }

  const sorted = [...amounts].sort((a, b) => a - b);
  const low = sorted[0];
  const high = sorted[sorted.length - 1];
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
      : sorted[mid];
  const spreadRatio = low > 0 ? high / low : Infinity;

  return {
    median,
    low,
    high,
    aligned: spreadRatio <= 2.0,
    spreadRatio: Math.round(spreadRatio * 100) / 100,
  };
}

// ─── Message formatting ──────────────────────────────────────────────────────

/**
 * Format a poll as a numbered SMS message.
 */
export function formatPollMessage(title: string, options: string[]): string {
  const lines = [title, ''];
  options.forEach((opt, i) => {
    lines.push(`${i + 1}. ${opt}`);
  });
  lines.push('', `Reply 1-${options.length} or type your pick.`);
  return lines.join('\n');
}

/**
 * Format budget poll message (special format with tiers + free text).
 */
export function formatBudgetPollMessage(): string {
  return [
    "Quick budget check \u2014 what's everyone working with for flights + lodging combined?",
    'Reply 1\u20134, or SKIP and I\u2019ll flag if anything looks tight.',
    '',
    '1. Under $500',
    '2. $500\u2013$1,000',
    '3. $1,000\u2013$2,000',
    '4. $2,000+',
    '',
    'Or: type any number',
  ].join('\n');
}

// ─── Phase-specific poll launchers ───────────────────────────────────────────

/**
 * Try to match an inbound message body to a poll option.
 * Accepts: numeric ("1", "2"), or free-text match against option labels.
 * Returns the matching option_id, or null.
 */
export async function matchVoteToOption(
  admin: SupabaseClient,
  pollId: string,
  body: string,
): Promise<string | null> {
  const { data: options } = await admin
    .from('poll_options')
    .select('id, label, position')
    .eq('poll_id', pollId)
    .order('position');

  if (!options || options.length === 0) return null;

  const trimmed = body.trim();

  // Numeric match (1-indexed)
  const num = parseInt(trimmed);
  if (!isNaN(num) && num >= 1 && num <= options.length) {
    return options[num - 1].id;
  }

  // Free-text match (case-insensitive, partial match)
  const lower = trimmed.toLowerCase();
  for (const opt of options) {
    if (opt.label.toLowerCase() === lower) return opt.id;
    if (opt.label.toLowerCase().includes(lower) || lower.includes(opt.label.toLowerCase())) {
      return opt.id;
    }
  }

  return null;
}

/**
 * Process an inbound message during an active poll.
 * Returns a response message if the vote was recorded or the poll resolved,
 * or null if the message wasn't a vote.
 */
export async function handlePollResponse(
  admin: SupabaseClient,
  session: TripSession,
  poll: Poll,
  respondentId: string,
  participantName: string,
  body: string,
  activeParticipantCount: number,
): Promise<string | null> {
  // Try to match the message to a poll option
  const optionId = await matchVoteToOption(admin, poll.id, body);

  if (!optionId) {
    // Check if it looks like a vote attempt (single number) but out of range
    const num = parseInt(body.trim());
    if (!isNaN(num) && num > 0) {
      const { data: opts } = await admin.from('poll_options').select('id').eq('poll_id', poll.id);
      const count = opts?.length ?? 0;
      if (num > count) {
        return `Reply 1\u2013${count} to vote.`;
      }
    }
    return null; // Not a vote — let it pass through
  }

  // Record the vote
  await recordVote(admin, poll, respondentId, optionId);

  // Check if all votes are in
  const allIn = await allVotesIn(admin, poll.id, activeParticipantCount);

  if (allIn) {
    // Resolve the poll
    const results = await getPollResults(admin, poll.id);
    const { winner, tied } = resolveWinner(results);

    await closePoll(admin, session, poll.id, winner);

    // Apply the winner to the session based on poll type
    if (winner) {
      const pollType = poll.type;
      if (pollType === 'destination_vote' || pollType === 'destination') {
        await admin.from('trip_sessions').update({ destination: winner }).eq('id', session.id);
      } else if (pollType === 'dates') {
        // Look up the winning date option from stored deadlines (temp storage)
        const { data: sess } = await admin.from('trip_sessions').select('deadlines').eq('id', session.id).single();
        const dateOptions = (sess?.deadlines ?? []) as Array<{ start: string; end: string; label: string }>;
        const winningDate = dateOptions.find((o) => o.label === winner);
        if (winningDate) {
          const nights = Math.round((new Date(winningDate.end).getTime() - new Date(winningDate.start).getTime()) / (24 * 60 * 60 * 1000));
          await admin.from('trip_sessions').update({
            dates: { start: winningDate.start, end: winningDate.end, nights },
            deadlines: '[]', // clear temp storage
          }).eq('id', session.id);
        }
      } else if (pollType === 'lodging_type') {
        const typeMap: Record<string, string> = {
          'Staying together (group rental)': 'GROUP',
          'Booking separately': 'INDIVIDUAL',
          'Flights only (skip lodging)': 'FLIGHTS_ONLY',
        };
        const mappedType = typeMap[winner] ?? winner;
        await admin.from('trip_sessions').update({ lodging_type: mappedType }).eq('id', session.id);
      }
    }

    // Format results
    const resultLines = results
      .sort((a, b) => b.count - a.count)
      .map((r) => `${r.label}: ${r.count} vote${r.count !== 1 ? 's' : ''}`);

    let msg = resultLines.join('\n');
    if (tied) {
      msg += `\n\nIt's a tie \u2014 flipping a coin... ${winner} wins. Let's go!`;
    } else {
      msg += `\n\n${winner} it is!`;
    }

    return msg;
  }

  // Vote recorded but poll still open
  return null;
}

/**
 * Process a budget poll response.
 * Returns a response message when budget analysis is complete, or null.
 */
export async function handleBudgetResponse(
  admin: SupabaseClient,
  session: TripSession,
  participant: TripSessionParticipant,
  body: string,
): Promise<string | null> {
  const { amount, skipped } = normalizeBudget(body);

  // Only store budget_raw when the message is a recognizable budget response
  // (tier 1-4, SKIP, or a dollar amount). Casual messages like "works" or "same"
  // shouldn't count as budget responses — they're likely replying to another human.
  if (amount === null && !skipped) return null;

  // Update participant's budget
  await admin
    .from('trip_session_participants')
    .update({
      budget_raw: body.trim(),
      budget_normalized: amount,
    })
    .eq('id', participant.id);

  // Check if all active participants have responded (or 24h has passed)
  const { data: allParticipants } = await admin
    .from('trip_session_participants')
    .select('budget_raw, budget_normalized')
    .eq('trip_session_id', session.id)
    .eq('status', 'active');

  if (!allParticipants) return null;

  const responded = allParticipants.filter((p) => p.budget_raw !== null);
  const total = allParticipants.length;

  if (responded.length < total) return null; // Still waiting

  // Everyone has responded — analyze
  const amounts = responded
    .map((p) => p.budget_normalized as number)
    .filter((a) => a !== null && a > 0);

  if (amounts.length === 0) {
    // All skipped
    await admin
      .from('trip_sessions')
      .update({ budget_status: 'SKIPPED', updated_at: new Date().toISOString() })
      .eq('id', session.id);
    return "Everyone skipped budget \u2014 no worries, I'll flag if anything looks tight.";
  }

  const analysis = analyzeBudget(amounts);

  await admin
    .from('trip_sessions')
    .update({
      budget_median: analysis.median,
      budget_range: { low: analysis.low, high: analysis.high },
      budget_status: analysis.aligned ? 'ALIGNED' : 'DISPUTED',
      updated_at: new Date().toISOString(),
    })
    .eq('id', session.id);

  if (analysis.aligned) {
    return `Budget check: you're all roughly in the $${analysis.low}\u2013$${analysis.high}/person range. Median: $${analysis.median}/person. Moving on.`;
  }

  // Disputed
  return (
    `Budgets range from $${analysis.low} to $${analysis.high}/person \u2014 that's a wide spread. ` +
    `Talk it out and reply READY when you've figured it out, or the planner can text BUDGET SET $[amount] to override.`
  );
}
