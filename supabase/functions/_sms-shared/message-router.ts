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

// ─── Keyword detection ───────────────────────────────────────────────────────

const KEYWORDS: Record<string, { plannerOnly: boolean }> = {
  STOP: { plannerOnly: false },
  REJOIN: { plannerOnly: false },
  HELP: { plannerOnly: false },
  STATUS: { plannerOnly: false },
  FOCUS: { plannerOnly: false },
  BOOKED: { plannerOnly: false },
  'PAID STATUS': { plannerOnly: false },
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

/**
 * Detect if the message is a keyword command.
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

    if (plannerOnly && !isPlanner) {
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
    const nameMatch = body.match(/^([A-Za-z]+)\s*[—–-]\s*(.+)/);
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

      if (upper === 'YES') {
        const name = fromUser.display_name ?? 'Someone';
        return `${name}'s flights are locked in \u{1F512}`;
      }
      return null;
    }
  }

  // Check for active poll first — if one is open, try to match as a vote
  const participants = await getParticipants(admin, session.id);
  const openPoll = await getOpenPoll(admin, session.id);

  if (openPoll) {
    // Budget poll has special handling
    if (openPoll.type === 'budget' && message.participant) {
      const budgetResult = await handleBudgetResponse(admin, session, message.participant, body);
      if (budgetResult) return budgetResult;
    }

    // Standard vote poll — match response to option
    if (session.trip_id) {
      const respondentId = await ensureRespondent(admin, session.trip_id, fromUser);
      const activeCount = participants.filter((p) => p.status === 'active').length;
      const name = fromUser.display_name ?? fromUser.phone;

      const pollResult = await handlePollResponse(
        admin, session, openPoll, respondentId, name, body, activeCount,
      );
      if (pollResult) return pollResult;
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

  return null;
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
