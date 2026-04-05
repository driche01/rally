/**
 * Component 4: MessageRouter
 *
 * Routes inbound messages to the correct handler based on:
 * 1. Keyword commands (checked first, always immediate)
 * 2. Current session phase
 *
 * Returns a response body string (or null if no response needed).
 */
import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { SmsUser } from './phone-user-linker.ts';
import type { TripSession, TripSessionParticipant } from './trip-session.ts';
import { getParticipants } from './trip-session.ts';
import { parseConversation, applyDecisions } from './conversation-parser.ts';
import { getOpenPoll, handlePollResponse, handleBudgetResponse } from './poll-engine.ts';
import { ensureRespondent } from './phone-user-linker.ts';
import { handleCommitResponse, handlePlannerDecision } from './commit-poll-engine.ts';
import {
  parseSplitIntent,
  handleSplitCommand,
  launchPropose,
  handleProposeResponse,
  handleProposePaid,
} from './venmo-split-link.ts';
import { handleReEngagementYes } from './post-trip-reengager.ts';
import { advancePhase, checkAutoAdvance } from './phase-flow.ts';

// ─── Keyword detection ───────────────────────────────────────────────────────

const KEYWORDS: Record<string, { plannerOnly: boolean }> = {
  STOP: { plannerOnly: false },
  REJOIN: { plannerOnly: false },
  HELP: { plannerOnly: false },
  STATUS: { plannerOnly: false },
  FOCUS: { plannerOnly: false },
  BOOKED: { plannerOnly: false },
  'PAID STATUS': { plannerOnly: false },
  NEXT: { plannerOnly: true },
  RESET: { plannerOnly: true },
  PAUSE: { plannerOnly: true },
  RESUME: { plannerOnly: true },
};

// Keywords that take arguments (checked via prefix)
const PREFIX_KEYWORDS: Record<string, { plannerOnly: boolean }> = {
  PLANNER: { plannerOnly: true },
  DEADLINE: { plannerOnly: true },
  DESTINATION: { plannerOnly: true },
  SPLIT: { plannerOnly: false },
  PROPOSE: { plannerOnly: false },
  FLIGHTS: { plannerOnly: true },
};

export interface RoutedMessage {
  type: 'keyword' | 'phase' | '1to1' | 'new_session';
  keyword?: string;
  keywordArgs?: string;
  body: string;
  fromUser: SmsUser;
  session: TripSession | null;
  participant: TripSessionParticipant | null;
  is1to1: boolean;
}

// Common typo mappings for fuzzy keyword matching
const TYPO_MAP: Record<string, string> = {
  STAUS: 'STATUS', STAUTS: 'STATUS', SATUS: 'STATUS', STATU: 'STATUS',
  STATS: 'STATUS', STATSU: 'STATUS',
  HLEP: 'HELP', HEPL: 'HELP', HALP: 'HELP',
  REUSME: 'RESUME', RESME: 'RESUME', RESMUE: 'RESUME',
  PASE: 'PAUSE', PASUE: 'PAUSE', PUASE: 'PAUSE',
  RSEET: 'RESET', RESTE: 'RESET',
  FOCSU: 'FOCUS', FOUCS: 'FOCUS',
  BOOOKD: 'BOOKED', BOKKED: 'BOOKED', BOOKD: 'BOOKED',
  STPO: 'STOP', SOTP: 'STOP',
  REJION: 'REJOIN', REJON: 'REJOIN',
  NXET: 'NEXT', NETX: 'NEXT',
};

/**
 * Detect if the message is a keyword command.
 * Supports exact match + common typo fuzzy matching.
 * Returns the keyword and any arguments, or null.
 */
function detectKeyword(body: string): { keyword: string; args: string } | null {
  const upper = body.trim().toUpperCase();

  // Check exact keywords first
  for (const kw of Object.keys(KEYWORDS)) {
    if (upper === kw) return { keyword: kw, args: '' };
  }

  // Check prefix keywords
  for (const kw of Object.keys(PREFIX_KEYWORDS)) {
    if (upper.startsWith(kw + ' ') || upper === kw) {
      const args = body.trim().slice(kw.length).trim();
      return { keyword: kw, args };
    }
  }

  // Fuzzy match common typos
  const corrected = TYPO_MAP[upper];
  if (corrected) return { keyword: corrected, args: '' };

  return null;
}

/**
 * Route an inbound message and return a response.
 *
 * This is the main entry point after TwilioWebhookReceiver has parsed
 * and validated the message and PhoneUserLinker has resolved the user.
 */
export async function routeMessage(
  admin: SupabaseClient,
  message: RoutedMessage,
): Promise<string | null> {
  const { session, fromUser, body, is1to1 } = message;

  // ─── 1:1 message (no group thread) ─────────────────────────────────────
  if (is1to1) {
    return handle1to1(admin, fromUser);
  }

  // ─── No existing session — new group thread ────────────────────────────
  if (!session) {
    // This is handled by the webhook receiver (creates session + routes back)
    return null;
  }

  // ─── Re-engagement YES ────────────────────────────────────────────────
  if (session.status === 'RE_ENGAGEMENT_PENDING' && body.trim().toUpperCase() === 'YES') {
    const result = await handleReEngagementYes(admin, session.id, fromUser.id);
    if (result) return result.message;
  }

  // ─── Keyword commands ──────────────────────────────────────────────────
  const kw = detectKeyword(body);
  if (kw) {
    // Check planner-only restriction
    const isPlanner = message.participant?.is_planner ?? false;
    const plannerOnly =
      KEYWORDS[kw.keyword]?.plannerOnly ?? PREFIX_KEYWORDS[kw.keyword]?.plannerOnly ?? false;

    // Check planner status via session.planner_user_id (more reliable than participant flag)
    const isSessionPlanner = message.fromUser.id === session.planner_user_id || isPlanner;
    if (plannerOnly && !isSessionPlanner) {
      const plannerName = await getPlannerName(admin, session);
      return `Only ${plannerName} can do that.`;
    }

    return handleKeyword(admin, kw.keyword, kw.args, message);
  }

  // ─── Phase-based routing ───────────────────────────────────────────────
  return handlePhaseMessage(admin, message);
}

// ─── 1:1 handler ─────────────────────────────────────────────────────────────

async function handle1to1(admin: SupabaseClient, user: SmsUser): Promise<string> {
  // Register as pending planner
  await admin.from('pending_planners').upsert(
    {
      phone: user.phone,
      registered_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    },
    { onConflict: 'phone' },
  );

  return (
    "Hey! I'm Rally \u2014 I help groups plan trips fast. " +
    "You're registered as the trip organizer. " +
    'Now add me to a group thread with your crew and I\u2019ll take it from there. ' +
    'Reply STOP anytime to opt out.'
  );
}

// ─── Keyword handlers ────────────────────────────────────────────────────────

async function handleKeyword(
  admin: SupabaseClient,
  keyword: string,
  args: string,
  message: RoutedMessage,
): Promise<string | null> {
  const { session, fromUser } = message;
  if (!session) return null;

  switch (keyword) {
    case 'STOP':
      return handleStop(admin, session, fromUser);
    case 'REJOIN':
      return handleRejoin(admin, session, fromUser);
    case 'HELP':
      return handleHelp(session);
    case 'STATUS':
    case 'FOCUS':
      return handleStatus(admin, session);
    case 'PAUSE':
      return handlePause(admin, session);
    case 'RESUME':
      return handleResume(admin, session);
    case 'BOOKED':
      return handleBooked(admin, session, fromUser);
    case 'PAID STATUS':
      return handlePaidStatus(admin, session);
    case 'NEXT':
      return handleNext(admin, session, fromUser);
    case 'RESET':
      return 'Reset everything? I\u2019ll keep the group but clear all decisions. Reply YES to confirm.';
    case 'SPLIT':
      return handleSplitKeyword(admin, session, fromUser, args);
    case 'PROPOSE':
      return handleProposeKeyword(admin, session, fromUser, args);
    default:
      return `Got it \u2014 ${keyword} ${args}.`;
  }
}

async function handleStop(
  admin: SupabaseClient,
  session: TripSession,
  user: SmsUser,
): Promise<string> {
  await admin
    .from('trip_session_participants')
    .update({ status: 'opted_out' })
    .eq('trip_session_id', session.id)
    .eq('user_id', user.id);

  await admin.from('users').update({ opted_out: true }).eq('id', user.id);

  return "Got it, I won't message you anymore. The group can still use me.";
}

async function handleRejoin(
  admin: SupabaseClient,
  session: TripSession,
  user: SmsUser,
): Promise<string> {
  await admin
    .from('trip_session_participants')
    .update({ status: 'active' })
    .eq('trip_session_id', session.id)
    .eq('user_id', user.id);

  await admin.from('users').update({ opted_out: false }).eq('id', user.id);

  return "Welcome back! You're back in the group.";
}

function handleHelp(session: TripSession): string {
  const phase = session.phase;
  return (
    `Current phase: ${phase}. ` +
    'Commands: STATUS, FOCUS, HELP, STOP, REJOIN, BOOKED, PAID STATUS. ' +
    'Planner commands: RESET, PAUSE, RESUME, DEADLINE, DESTINATION, FLIGHTS, PLANNER.'
  );
}

async function handleStatus(admin: SupabaseClient, session: TripSession): Promise<string> {
  const parts: string[] = [];

  if (session.destination) parts.push(`Destination: ${session.destination}`);
  if (session.dates) parts.push(`Dates: ${session.dates.start}\u2013${session.dates.end}`);

  const { data: participants } = await admin
    .from('trip_session_participants')
    .select('display_name, committed, flight_status')
    .eq('trip_session_id', session.id)
    .eq('status', 'active');

  const total = participants?.length ?? 0;
  const committed = participants?.filter((p) => p.committed).length ?? 0;
  if (committed > 0) parts.push(`${committed}/${total} confirmed`);

  if (session.lodging_property) parts.push(`Lodging: ${session.lodging_property}`);

  parts.push(`Phase: ${session.phase}`);

  return parts.join('\n') || 'No decisions locked yet.';
}

async function handlePause(admin: SupabaseClient, session: TripSession): Promise<string> {
  await admin
    .from('trip_sessions')
    .update({ paused: true, paused_at: new Date().toISOString() })
    .eq('id', session.id);

  // Cancel pending scheduled actions
  await admin
    .from('scheduled_actions')
    .update({ executed_at: new Date().toISOString() })
    .eq('trip_session_id', session.id)
    .is('executed_at', null);

  return 'Paused \u2014 text RESUME whenever you\u2019re ready to pick up where you left off.';
}

async function handleResume(admin: SupabaseClient, session: TripSession): Promise<string> {
  // Check if dates have passed
  if (session.dates?.start) {
    const start = new Date(session.dates.start);
    if (start < new Date()) {
      return "Looks like those dates have passed \u2014 reply with new dates or RESET to start fresh.";
    }
  }

  await admin
    .from('trip_sessions')
    .update({ paused: false, paused_at: null })
    .eq('id', session.id);

  return await handleStatus(admin, session);
}

async function handleBooked(
  admin: SupabaseClient,
  session: TripSession,
  user: SmsUser,
): Promise<string> {
  await admin
    .from('trip_session_participants')
    .update({ flight_status: 'confirmed' })
    .eq('trip_session_id', session.id)
    .eq('user_id', user.id);

  const name = user.display_name ?? 'Someone';
  return `${name}'s flights are locked in \ud83d\udd12 who's next?`;
}

async function handlePaidStatus(admin: SupabaseClient, session: TripSession): Promise<string> {
  const { data: splits } = await admin
    .from('split_requests')
    .select('payer_user_id, status')
    .eq('trip_session_id', session.id);

  if (!splits || splits.length === 0) return 'No splits to track yet.';

  const paid = splits.filter((s) => s.status === 'paid').length;
  const pending = splits.filter((s) => s.status === 'pending').length;

  return `Paid: ${paid}. Still waiting: ${pending}.`;
}

// ─── Phase message handler ───────────────────────────────────────────────────

async function handlePhaseMessage(
  admin: SupabaseClient,
  message: RoutedMessage,
): Promise<string | null> {
  const { session, fromUser, body } = message;
  if (!session) return null;
  const phase = session.phase;

  // During INTRO, collect names and destination ideas
  if (phase === 'INTRO') {
    // Extract name from "Name — destination" pattern
    const nameMatch = body.match(/^([\p{L}][\p{L}'\-]{0,30})\s*[—–\-]\s*(.+)/u);
    if (nameMatch) {
      const name = nameMatch[1].trim();
      const destinationIdea = nameMatch[2].trim();

      // Update participant display name
      await admin
        .from('trip_session_participants')
        .update({ display_name: name })
        .eq('trip_session_id', session.id)
        .eq('user_id', fromUser.id);

      // Update user display name
      await admin
        .from('users')
        .update({ display_name: name })
        .eq('id', fromUser.id);

      // Update respondent name
      if (session.trip_id) {
        await admin
          .from('respondents')
          .update({ name })
          .eq('trip_id', session.trip_id)
          .eq('phone', fromUser.phone);
      }

      // Add destination to candidates
      const existingCandidates = ((session as Record<string, unknown>).destination_candidates as Array<{ label: string; votes: number }>) ?? [];
      const alreadyListed = existingCandidates.some(
        (c) => c.label.toLowerCase() === destinationIdea.toLowerCase(),
      );
      if (!alreadyListed) {
        existingCandidates.push({ label: destinationIdea, votes: 1 });
        await admin
          .from('trip_sessions')
          .update({ destination_candidates: existingCandidates })
          .eq('id', session.id);
      }

      // Check if all participants now have names — auto-advance
      const autoMsg = await checkAutoAdvance(admin, session);
      if (autoMsg) {
        return `Got it, ${name} \u2014 ${destinationIdea} is on the list!\n\n${autoMsg}`;
      }
      return `Got it, ${name} \u2014 ${destinationIdea} is on the list!`;
    }
    return null;
  }

  // Commit poll — YES/NO during COMMIT_POLL phase
  if (phase === 'COMMIT_POLL' && message.participant) {
    const upper = body.trim().toUpperCase();
    if (upper === 'YES' || upper === 'NO') {
      const result = await handleCommitResponse(
        admin, session, message.participant, upper.toLowerCase() as 'yes' | 'no',
      );
      if (result) return result;
      return null; // Still collecting
    }
  }

  // Solo planner decision — CONTINUE/CANCEL
  if (phase === 'AWAITING_PLANNER_DECISION') {
    const upper = body.trim().toUpperCase();
    if (upper === 'CONTINUE' || upper === 'CANCEL') {
      return handlePlannerDecision(admin, session, upper.toLowerCase() as 'continue' | 'cancel');
    }
  }

  // Date collection during DECIDING_DATES — only when no poll is open
  // Skip emoji-only and very short messages
  if (phase === 'DECIDING_DATES' && message.participant && !(session as Record<string,unknown>).current_poll_id && /[a-zA-Z0-9]/.test(body)) {
    // Store this participant's date preference as budget_raw (reuse field for date input tracking)
    await admin
      .from('trip_session_participants')
      .update({ budget_raw: body.trim() })
      .eq('id', message.participant.id);

    // Try regex first for exact dates (e.g. "Nov 8-12", "Jan 15-19")
    const dateMatch = body.match(/(\w+)\s+(\d{1,2})\s*[-–to]+\s*(\d{1,2})/i);
    if (dateMatch) {
      const monthStr = dateMatch[1];
      const startDay = parseInt(dateMatch[2]);
      const endDay = parseInt(dateMatch[3]);
      const months: Record<string, number> = {
        jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2,
        apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6,
        aug: 7, august: 7, sep: 8, september: 8, oct: 9, october: 9,
        nov: 10, november: 10, dec: 11, december: 11,
      };
      const month = months[monthStr.toLowerCase()];
      if (month !== undefined && startDay > 0 && endDay > 0) {
        const year = new Date().getFullYear();
        const start = new Date(year, month, startDay);
        const end = new Date(year, month, endDay);
        if (start < new Date()) { start.setFullYear(year + 1); end.setFullYear(year + 1); }
        const startStr = start.toISOString().split('T')[0];
        const endStr = end.toISOString().split('T')[0];
        const nights = Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
        await admin.from('trip_sessions').update({
          dates: { start: startStr, end: endStr, nights },
          updated_at: new Date().toISOString(),
        }).eq('id', session.id);
        const nextMsg = await advancePhase(admin, session);
        const dateMsg = `Got it \u2014 ${monthStr} ${startDay}\u2013${endDay} (${nights} nights).`;
        return nextMsg ? dateMsg + '\n\n' + nextMsg : dateMsg;
      }
    }

    // Check if all participants have responded with date preferences
    const { data: allP } = await admin
      .from('trip_session_participants')
      .select('budget_raw')
      .eq('trip_session_id', session.id)
      .eq('status', 'active');
    const allResponded = (allP ?? []).every((p) => p.budget_raw);

    if (allResponded && !session.dates) {
      // Everyone responded but no exact date parsed — use Haiku to extract
      const { data: dateMessages } = await admin
        .from('thread_messages')
        .select('sender_phone, body')
        .eq('trip_session_id', session.id)
        .eq('direction', 'inbound')
        .order('created_at', { ascending: false })
        .limit(10);

      const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
      if (apiKey) {
        const history = (dateMessages ?? []).reverse().map((m) => m.body).join('\n');
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 200,
            messages: [{ role: 'user', content: `The group is deciding trip dates. Here are their messages:\n${history}\n\nExtract ALL possible date windows that could work for the group. Use the current year (${new Date().getFullYear()}) or next year if dates are in the past. Return ONLY a JSON object: { "options": [{ "start": "YYYY-MM-DD", "end": "YYYY-MM-DD", "label": "short label like Apr 17-20" }], "summary": "one sentence about what the group said" }. If you can't determine any specific dates, return { "options": [], "summary": "what they said" }.` }],
          }),
        });
        if (res.ok) {
          const result = await res.json();
          const text = result.content?.[0]?.text ?? '';
          try {
            const parsed = JSON.parse(text.replace(/```json\s*/i, '').replace(/```\s*$/i, '').trim());
            const options = parsed.options ?? [];

            if (options.length === 1) {
              // One clear option — lock it in
              const opt = options[0];
              const nights = Math.round((new Date(opt.end).getTime() - new Date(opt.start).getTime()) / (24 * 60 * 60 * 1000));
              await admin.from('trip_sessions').update({
                dates: { start: opt.start, end: opt.end, nights },
                updated_at: new Date().toISOString(),
              }).eq('id', session.id);
              const nextMsg = await advancePhase(admin, session);
              const dateMsg = `Got it \u2014 ${opt.label ?? opt.start + ' to ' + opt.end} (${nights} nights).`;
              return nextMsg ? dateMsg + '\n\n' + nextMsg : dateMsg;
            } else if (options.length > 1) {
              // Multiple options — create a date vote poll
              const { data: freshS } = await admin.from('trip_sessions').select('*').eq('id', session.id).single();
              if (freshS) {
                const labels = options.map((o: { label: string }) => o.label);
                // Store options metadata on session for later lookup
                await admin.from('trip_sessions').update({
                  deadlines: options, // temporarily store date options here
                }).eq('id', session.id);
                const { createPoll, formatPollMessage } = await import('./poll-engine.ts');
                await createPoll(admin, freshS, 'dates', 'Which dates work best?', labels);
                return `${parsed.summary ?? 'A few options came up.'}\n\n` + formatPollMessage('Vote on dates:', labels);
              }
            } else {
              return `Hearing ${parsed.summary ?? 'some ideas'}. Can someone nail down specific dates? Like "Apr 17-20"`;
            }
          } catch { /* fall through */ }
        }
      }

      return "Got everyone's input on dates. Can someone nail down the exact dates? Like \"Apr 17-20\"";
    }

    // Not all responded yet — acknowledge
    const name = fromUser.display_name ?? 'Got it';
    return `${name} \u2014 noted.`;
  }

  // Origin collection during COLLECTING_ORIGINS
  if (phase === 'COLLECTING_ORIGINS' && message.participant) {
    // Store the origin (city or airport code)
    const origin = body.trim();
    if (origin.length >= 2 && origin.length <= 50) {
      const isAirportCode = /^[A-Z]{3}$/i.test(origin);
      await admin
        .from('trip_session_participants')
        .update({
          origin_city: isAirportCode ? null : origin,
          origin_airport: isAirportCode ? origin.toUpperCase() : null,
        })
        .eq('id', message.participant.id);

      const name = fromUser.display_name ?? 'Got it';
      const autoMsg = await checkAutoAdvance(admin, session);
      if (autoMsg) return `${name} \u2014 ${origin}. ${autoMsg}`;
      return `${name} \u2014 ${origin}. Waiting on the rest.`;
    }
  }

  // Flight status collection during AWAITING_FLIGHTS
  if (phase === 'AWAITING_FLIGHTS' && message.participant) {
    const upper = body.trim().toUpperCase();
    if (['YES', 'NOT YET', 'DRIVING'].includes(upper)) {
      const statusMap: Record<string, string> = {
        'YES': 'confirmed',
        'NOT YET': 'not_yet',
        'DRIVING': 'driving',
      };
      await admin
        .from('trip_session_participants')
        .update({ flight_status: statusMap[upper] })
        .eq('id', message.participant.id);

      // Check if all have responded → auto-advance to lodging
      const allP = await getParticipants(admin, session.id);
      const activeP = allP.filter((p) => p.status === 'active');
      const allResponded = activeP.every(
        (p) => p.flight_status !== 'unknown' || p.user_id === fromUser.id,
      );
      // Re-check with updated data
      const { data: freshP } = await admin
        .from('trip_session_participants')
        .select('flight_status')
        .eq('trip_session_id', session.id)
        .eq('status', 'active');
      const allDone = (freshP ?? []).every((p) => p.flight_status !== 'unknown');

      if (allDone) {
        const advMsg = await advancePhase(admin, session);
        const name = fromUser.display_name ?? 'Someone';
        const ack = upper === 'YES' ? `${name}'s flights are locked in \u{1F512}` : '';
        return ack ? (advMsg ? ack + '\n\n' + advMsg : ack) : advMsg;
      }

      if (upper === 'YES') {
        const name = fromUser.display_name ?? 'Someone';
        return `${name}'s flights are locked in \u{1F512}`;
      }
      return null;
    }
  }

  // Group lodging booking confirmation during AWAITING_GROUP_BOOKING
  if (phase === 'AWAITING_GROUP_BOOKING') {
    // Parse "Booked [property] for $[amount]"
    const bookMatch = body.match(/booked?\s+(.+?)\s+for\s+\$?([\d,]+(?:\.\d{2})?)/i);
    if (bookMatch) {
      const property = bookMatch[1].trim();
      const cost = parseFloat(bookMatch[2].replace(',', ''));

      await admin.from('trip_sessions').update({
        lodging_property: property,
        lodging_cost: cost,
        status: 'FIRST_BOOKING_REACHED',
        updated_at: new Date().toISOString(),
      }).eq('id', session.id);

      // Also update the linked trip
      if (session.trip_id) {
        await admin.from('trips').update({ status: 'active' }).eq('id', session.trip_id);
      }

      const allP = await getParticipants(admin, session.id);
      const committed = allP.filter((p) => p.committed || p.status === 'active');
      const perPerson = committed.length > 0 ? Math.round(cost / committed.length) : cost;

      return `You're booked! \u{1F389} ${property} for $${cost} total ($${perPerson}/person for ${committed.length}).`;
    }
  }

  // Individual lodging/flights confirmation during AWAITING_INDIVIDUAL_*
  if ((phase === 'AWAITING_INDIVIDUAL_LODGING' || phase === 'AWAITING_INDIVIDUAL_FLIGHTS') && message.participant) {
    const upper = body.trim().toUpperCase();
    if (upper === 'BOOKED' || upper === 'YES' || upper === 'DONE') {
      await admin
        .from('trip_session_participants')
        .update({ committed: true })
        .eq('id', message.participant.id);

      // Check if all have confirmed
      const { data: freshP } = await admin
        .from('trip_session_participants')
        .select('committed')
        .eq('trip_session_id', session.id)
        .eq('status', 'active');
      const allBooked = (freshP ?? []).every((p) => p.committed);

      if (allBooked) {
        await admin.from('trip_sessions').update({
          status: 'FIRST_BOOKING_REACHED',
          updated_at: new Date().toISOString(),
        }).eq('id', session.id);

        return "Everyone's booked! \u{1F389} First booking is locked. Trip is happening!";
      }

      const name = fromUser.display_name ?? 'Someone';
      return `${name} is sorted \u{2705}`;
    }
  }

  // Budget poll phase — handle budget responses (only when no vote poll is open)
  if (phase === 'BUDGET_POLL' && message.participant && !(session as Record<string,unknown>).current_poll_id) {
    const budgetResult = await handleBudgetResponse(admin, session, message.participant, body);
    if (budgetResult) {
      // Budget resolved — advance phase
      const { data: updatedSession } = await admin.from('trip_sessions').select('*').eq('id', session.id).single();
      if (updatedSession) {
        const nextMsg = await advancePhase(admin, updatedSession);
        if (nextMsg) return budgetResult + '\n\n' + nextMsg;
      }
      return budgetResult;
    }
  }

  // Check for active poll first — if one is open, try to match as a vote
  const participants = await getParticipants(admin, session.id);
  const openPoll = await getOpenPoll(admin, session.id);

  if (openPoll) {

    // Standard vote poll — match response to option
    if (session.trip_id) {
      const respondentId = await ensureRespondent(admin, session.trip_id, fromUser);
      const activeCount = participants.filter((p) => p.status === 'active').length;
      const name = fromUser.display_name ?? fromUser.phone;

      const pollResult = await handlePollResponse(
        admin, session, openPoll, respondentId, name, body, activeCount,
      );
      if (pollResult) {
        // Poll resolved — advance to next phase
        // Reload session to get updated state (winner applied by poll-engine)
        const { data: updatedSession } = await admin
          .from('trip_sessions')
          .select('*')
          .eq('id', session.id)
          .single();
        if (updatedSession) {
          const advanceMsg = await advancePhase(admin, updatedSession);
          if (advanceMsg) return pollResult + '\n\n' + advanceMsg;
        }
        return pollResult;
      }
    }
  }

  // Run ConversationParser on active decision phases
  const decisions = await parseConversation(admin, session, participants, body);

  if (decisions) {
    const applied = await applyDecisions(admin, session, decisions);
    if (applied.length > 0) {
      console.log(`[message-router] Organic decisions detected: ${applied.join(', ')}`);

      if (applied.includes('destination')) {
        return `Sounds like you're already set on ${decisions.destination} \u2014 locking that in.`;
      }
      if (applied.includes('dates')) {
        const d = decisions.dates;
        return `Got it \u2014 ${d?.start} to ${d?.end} is locked in.`;
      }
      if (applied.includes('flight_status')) {
        return null;
      }
    }
  }

  // Check if the phase should auto-advance based on collected data
  const autoMsg = await checkAutoAdvance(admin, session);
  if (autoMsg) return autoMsg;

  return null;
}

// ─── NEXT handler (planner manually advances phase) ──────────────────────────

async function handleNext(
  admin: SupabaseClient,
  session: TripSession,
  user: SmsUser,
): Promise<string> {
  const result = await advancePhase(admin, session, user.id);
  return result ?? `Can't advance from ${session.phase} right now.`;
}

// ─── SPLIT / PROPOSE handlers ────────────────────────────────────────────────

async function handleSplitKeyword(
  admin: SupabaseClient,
  session: TripSession,
  user: SmsUser,
  args: string,
): Promise<string> {
  const intent = parseSplitIntent(args);
  if (!intent) {
    return 'Usage: SPLIT $[amount] [N] ways [reason]\nExample: SPLIT $1100 10 ways dinner';
  }

  return handleSplitCommand(
    admin, session, user.id, user.phone, user.display_name ?? user.phone, intent,
  );
}

async function handleProposeKeyword(
  admin: SupabaseClient,
  session: TripSession,
  user: SmsUser,
  args: string,
): Promise<string> {
  // Parse: PROPOSE $[amount] [reason]
  const match = args.match(/\$?([\d,]+(?:\.\d{2})?)\s+(.+)/);
  if (!match) {
    return 'Usage: PROPOSE $[amount] [reason]\nExample: PROPOSE $110 Gitano Beach dinner';
  }

  const amount = parseFloat(match[1].replace(',', ''));
  const reason = match[2].trim();

  if (isNaN(amount)) return 'Could not parse amount. Try: PROPOSE $110 dinner';

  return launchPropose(
    admin, session, user.id, user.display_name ?? user.phone, amount, reason,
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getPlannerName(admin: SupabaseClient, session: TripSession): Promise<string> {
  if (!session.planner_user_id) return 'the planner';

  const { data } = await admin
    .from('users')
    .select('display_name')
    .eq('id', session.planner_user_id)
    .maybeSingle();

  return data?.display_name ?? 'the planner';
}
