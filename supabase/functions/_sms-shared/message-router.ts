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
import { getOpenPoll, handlePollResponse, handleBudgetResponse, normalizeBudget } from './poll-engine.ts';
import { ensureRespondent } from './phone-user-linker.ts';
import { handleCommitResponse, handlePlannerDecision } from './commit-poll-engine.ts';
import {
  parseSplitIntent,
  handleSplitCommand,
  launchPropose,
  handleProposeResponse,
  handleProposePaid,
  handleProposeCancel,
} from './venmo-split-link.ts';
import { handleReEngagementYes } from './post-trip-reengager.ts';
import { advancePhase, checkAutoAdvance } from './phase-flow.ts';
import { classifyMessage } from './message-classifier.ts';
import { track } from './telemetry.ts';
import { broadcast, sendDm, shortHash } from './dm-sender.ts';
import { normalizePhone } from './phone.ts';
import { getOrCreateJoinLinkForSession } from './trip-session.ts';
import { joinConfirmationSms } from './templates.ts';

/**
 * Fan out an announcement to all active+attending participants other than
 * the triggering user. Phase 3 of the 1:1 SMS pivot. Best-effort.
 */
async function announceDecision(
  admin: SupabaseClient,
  sessionId: string,
  body: string,
  triggerUserId: string,
): Promise<void> {
  const seedHash = await shortHash(body);
  await broadcast(admin, sessionId, body, {
    excludeUserId: triggerUserId,
    idempotencyKey: `decision:${sessionId}:${seedHash}`,
  });
}

// ─── Keyword detection ───────────────────────────────────────────────────────

const KEYWORDS: Record<string, { plannerOnly: boolean }> = {
  STOP: { plannerOnly: false },
  REJOIN: { plannerOnly: false },
  HELP: { plannerOnly: false },
  STATUS: { plannerOnly: false },
  FOCUS: { plannerOnly: false },
  BOOKED: { plannerOnly: false },
  'PAID STATUS': { plannerOnly: false },
  CANCEL: { plannerOnly: false },
  NEXT: { plannerOnly: true },
  RESET: { plannerOnly: true },
  PAUSE: { plannerOnly: true },
  RESUME: { plannerOnly: true },
  DIGEST: { plannerOnly: true },
};

// Keywords that take arguments (checked via prefix)
const PREFIX_KEYWORDS: Record<string, { plannerOnly: boolean }> = {
  PLANNER: { plannerOnly: true },
  DEADLINE: { plannerOnly: true },
  DESTINATION: { plannerOnly: true },
  SPLIT: { plannerOnly: false },
  PROPOSE: { plannerOnly: false },
  FLIGHTS: { plannerOnly: true },
  BROADCAST: { plannerOnly: true },
  INVITE: { plannerOnly: true },
};

export interface RoutedMessage {
  type: 'keyword' | 'phase' | 'new_session';
  keyword?: string;
  keywordArgs?: string;
  body: string;
  fromUser: SmsUser;
  session: TripSession | null;
  participant: TripSessionParticipant | null;
}

// Helper: format session dates for display in confirmation messages
function formatSessionDates(session: TripSession): string {
  const dates = session.dates as { start?: string; end?: string; nights?: number } | null;
  if (!dates?.start || !dates?.end) return '';
  const start = new Date(dates.start + 'T12:00:00');
  const end = new Date(dates.end + 'T12:00:00');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[start.getMonth()]} ${start.getDate()}\u2013${end.getDate()}`;
}

// Known destination names for recognition (lowercase)
const KNOWN_DESTINATIONS = [
  'tulum', 'cancun', 'cancún', 'cabo', 'cabo san lucas', 'playa del carmen',
  'paris', 'london', 'tokyo', 'bali', 'bangkok', 'phuket',
  'hawaii', 'maui', 'oahu', 'kauai', 'big island',
  'aspen', 'park city', 'whistler', 'vail', 'steamboat', 'mammoth',
  'miami', 'key west', 'fort lauderdale', 'tampa', 'orlando',
  'barcelona', 'rome', 'florence', 'amalfi', 'santorini', 'mykonos',
  'amsterdam', 'lisbon', 'porto', 'berlin', 'prague', 'dublin',
  'mexico city', 'cdmx', 'costa rica', 'puerto rico', 'cartagena',
  'nashville', 'austin', 'scottsdale', 'vegas', 'las vegas', 'new orleans',
  'lake tahoe', 'lake shasta', 'shasta', 'sedona', 'joshua tree', 'palm springs',
  'jamaica', 'punta cana', 'aruba', 'bahamas', 'nassau', 'turks and caicos',
  'dominican republic', 'santo domingo',
  'iceland', 'portugal', 'spain', 'italy', 'greece', 'japan', 'thailand',
  'colombia', 'peru', 'argentina', 'brazil',
  'new york', 'nyc', 'los angeles', 'la', 'san francisco', 'chicago',
  'denver', 'seattle', 'portland', 'savannah', 'charleston',
];

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
function detectKeyword(body: string): { keyword: string; args: string; typoCorrection?: boolean } | null {
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
  if (corrected) return { keyword: corrected, args: '', typoCorrection: true };

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
  const { session, body, fromUser } = message;

  // No active session — inbound-processor handles new-planner kickoff +
  // welcome path before this is called. Defensive null-return for safety.
  if (!session) return null;

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
      return `Only the planner (${plannerName}) can ${kw.keyword.toLowerCase()}.`;
    }

    const result = await handleKeyword(admin, kw.keyword, kw.args, message);
    // Prepend typo correction hint
    if (result && kw.typoCorrection) {
      return `(I read that as ${kw.keyword})\n${result}`;
    }
    return result;
  }

  // ─── Phase-based routing ───────────────────────────────────────────────
  return handlePhaseMessage(admin, message);
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
      return handlePause(admin, session, fromUser);
    case 'RESUME':
      return handleResume(admin, session, fromUser);
    case 'BOOKED':
      return handleBooked(admin, session, fromUser);
    case 'PAID STATUS':
      return handlePaidStatus(admin, session);
    case 'NEXT':
      return handleNext(admin, session, fromUser);
    case 'RESET':
      return handleReset(admin, session, fromUser);
    case 'SPLIT':
      return handleSplitKeyword(admin, session, fromUser, args);
    case 'PROPOSE':
      return handleProposeKeyword(admin, session, fromUser, args);
    case 'CANCEL':
      return handleProposeCancel(admin, session, fromUser.id);
    case 'PLANNER':
      return handlePlannerTransfer(admin, session, fromUser, args);
    case 'BROADCAST':
      return handleBroadcastKeyword(admin, session, fromUser, args);
    case 'INVITE':
      return handleInviteKeyword(admin, session, fromUser, args);
    case 'DIGEST':
      return handleDigestKeyword(admin, session);
    default:
      return `Got it \u2014 ${keyword} ${args}.`;
  }
}

async function handlePlannerTransfer(
  admin: SupabaseClient,
  session: TripSession,
  user: SmsUser,
  args: string,
): Promise<string> {
  const targetName = args.trim();
  if (!targetName) return 'Usage: PLANNER [name]\nExample: PLANNER Sarah';

  const participants = await getParticipants(admin, session.id);
  const target = participants.find((p) =>
    p.display_name?.toLowerCase().includes(targetName.toLowerCase()) && p.status === 'active',
  );

  if (!target) return `Can't find "${targetName}" in the group.`;
  if (target.user_id === session.planner_user_id) return `${target.display_name} is already the planner.`;

  // Remove is_planner from current planner
  await admin.from('trip_session_participants')
    .update({ is_planner: false })
    .eq('trip_session_id', session.id)
    .eq('is_planner', true);

  // Set new planner
  await admin.from('trip_session_participants')
    .update({ is_planner: true })
    .eq('id', target.id);

  await admin.from('trip_sessions')
    .update({ planner_user_id: target.user_id })
    .eq('id', session.id);

  const msg = `${target.display_name} is now the trip planner.`;
  await announceDecision(admin, session.id, msg, user.id);
  return msg;
}

// ─── Phase 5 keyword handlers ───────────────────────────────────────────────

/**
 * BROADCAST <message> — planner-only fan-out via SMS. Mirrors the in-app
 * Group Dashboard's broadcast composer; same Phase 3 broadcast() helper.
 */
async function handleBroadcastKeyword(
  admin: SupabaseClient,
  session: TripSession,
  user: SmsUser,
  args: string,
): Promise<string> {
  const body = args.trim();
  if (!body) {
    return 'Usage: BROADCAST [message]\nExample: BROADCAST Heads up — flights are getting expensive.';
  }
  if (body.length > 1000) {
    return "That's too long for a broadcast — keep it under 1000 characters.";
  }

  const seedHash = await shortHash(body);
  const result = await broadcast(admin, session.id, body, {
    excludeUserId: user.id,
    idempotencyKey: `sms_broadcast:${session.id}:${seedHash}`,
  });

  track('sms_broadcast_keyword_sent', {
    distinct_id: session.id,
    sessionId: session.id,
    plannerUserId: user.id,
    sent: result.sent,
    failed: result.failed.length,
    trip_model: '1to1',
  }).catch(() => {});

  if (result.sent === 0 && result.failed.length === 0) {
    return "No active participants to broadcast to yet.";
  }
  return `Sent to ${result.sent} ${result.sent === 1 ? 'person' : 'people'}.`;
}

/**
 * INVITE <name> <phone> — planner-only direct add. Routes through the
 * Phase 1 join_link_submission consent flow so the invitee still has to
 * reply YES (carrier compliance: no opt-in-by-proxy).
 */
async function handleInviteKeyword(
  admin: SupabaseClient,
  session: TripSession,
  user: SmsUser,
  args: string,
): Promise<string> {
  const trimmed = args.trim();
  if (!trimmed) {
    return 'Usage: INVITE [name] [phone]\nExample: INVITE Sarah +15551234567';
  }

  // Extract a phone number anywhere in the args (E.164 or 10-digit US).
  const phoneMatch = trimmed.match(/(\+?\d[\d\s().\-]{8,17}\d)/);
  if (!phoneMatch) {
    return "I couldn't find a phone number. Try: INVITE Sarah +15551234567";
  }
  const rawPhone = phoneMatch[0];
  const normalized = normalizePhone(rawPhone);
  if (!normalized) {
    return "That phone number didn't look right. Try: INVITE Sarah +15551234567";
  }

  // Strip the phone from the args to get the name.
  const name = trimmed
    .replace(rawPhone, '')
    .replace(/[,\s]+$/, '')
    .replace(/^[,\s]+/, '')
    .trim() || normalized;

  // Already a participant? Short-circuit.
  const { data: existing } = await admin
    .from('trip_session_participants')
    .select('id, display_name, status')
    .eq('trip_session_id', session.id)
    .eq('phone', normalized)
    .maybeSingle();
  if (existing && existing.status === 'active') {
    return `${existing.display_name ?? name} is already in.`;
  }

  // Get or mint a join_link, then create a pending submission and send
  // the confirmation SMS so the invitee opts in via YES.
  const link = await getOrCreateJoinLinkForSession(admin, session.id, user.id);
  const { data: linkRow } = await admin.from('join_links').select('id').eq('code', link.code).single();
  if (!linkRow) {
    return "Couldn't generate an invite link. Try again in a moment.";
  }

  const { data: sub, error: subErr } = await admin
    .from('join_link_submissions')
    .insert({
      join_link_id: linkRow.id,
      phone: normalized,
      display_name: name,
      status: 'pending',
      confirmation_sent_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (subErr) {
    console.error('[invite] failed to insert submission:', subErr);
    return "Couldn't send the invite. Try again in a moment.";
  }

  // Pull planner display name for the confirmation SMS.
  const { data: plannerRow } = await admin
    .from('users').select('display_name').eq('id', user.id).maybeSingle();
  const plannerName = plannerRow?.display_name ?? null;

  const smsBody = joinConfirmationSms({
    recipientName: name,
    plannerName,
    destination: session.destination,
    dates: session.dates as { start?: string; end?: string } | null,
  });

  const sendResult = await sendDm(admin, normalized, smsBody, {
    tripSessionId: session.id,
    idempotencyKey: `invite_confirm:${sub.id}`,
  });
  if (sendResult.error) {
    return `Submission saved but couldn't text ${name} — try again, or share the link: ${link.url}`;
  }

  track('sms_invite_keyword_sent', {
    distinct_id: session.id,
    sessionId: session.id,
    plannerUserId: user.id,
    trip_model: '1to1',
  }).catch(() => {});

  return `Texted ${name} at ${normalized}. They'll reply YES to join.`;
}

/**
 * DIGEST — on-demand recap to the requesting planner. Delivered as the
 * TwiML reply (so it lands in the planner's 1:1 thread immediately).
 */
async function handleDigestKeyword(
  admin: SupabaseClient,
  session: TripSession,
): Promise<string> {
  const participants = await getParticipants(admin, session.id);
  const active = participants.filter((p) => p.status === 'active');
  const named = active.filter((p) => p.display_name);
  const committed = active.filter((p) => p.committed);
  const flightsBooked = active.filter((p) => p.flight_status === 'confirmed');

  const lines: string[] = [];

  // Headline: destination, dates, budget
  const headline: string[] = [];
  if (session.destination) headline.push(session.destination);
  if (session.dates) {
    const d = session.dates as { start?: string; end?: string };
    if (d.start && d.end) {
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const s = new Date(d.start + 'T12:00:00');
      const e = new Date(d.end + 'T12:00:00');
      headline.push(`${months[s.getMonth()]} ${s.getDate()}\u2013${e.getDate()}`);
    }
  }
  if (session.budget_median) headline.push(`~$${session.budget_median}/person`);
  if (headline.length) lines.push(headline.join(' \u00b7 '));

  // Phase
  lines.push(`Phase: ${session.phase.replace(/_/g, ' ').toLowerCase()}`);

  // Participation summary
  lines.push(`${active.length} in${named.length < active.length ? ` (${named.length} named)` : ''}`);
  if (committed.length > 0) lines.push(`${committed.length} committed`);
  if (flightsBooked.length > 0) lines.push(`${flightsBooked.length} flights booked`);

  // Recent broadcast count
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { count: bcCount } = await admin
    .from('thread_messages')
    .select('id', { count: 'exact', head: true })
    .eq('trip_session_id', session.id)
    .eq('sender_role', 'planner_broadcast')
    .gte('created_at', since);
  if (bcCount && bcCount > 0) lines.push(`${bcCount} broadcast${bcCount === 1 ? '' : 's'} this week`);

  return lines.join('\n');
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

  track('sms_opt_out', {
    distinct_id: session.id,
    sessionId: session.id,
    userId: user.id,
    via: 'stop_keyword',
  }).catch(() => {});

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
    `Current phase: ${phase}.\n\n` +
    'Anyone: STATUS, FOCUS, HELP, STOP, REJOIN, BOOKED, PAID STATUS.\n' +
    'Planner: BROADCAST <msg>, INVITE <name> <phone>, DIGEST, PAUSE, RESUME, RESET, NEXT, ' +
    'PLANNER <name>, DEADLINE, DESTINATION, FLIGHTS.'
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

async function handlePause(
  admin: SupabaseClient,
  session: TripSession,
  user: SmsUser,
): Promise<string> {
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

  const msg = 'Paused \u2014 text RESUME whenever you\u2019re ready to pick up where you left off.';
  await announceDecision(admin, session.id, msg, user.id);
  return msg;
}

async function handleResume(
  admin: SupabaseClient,
  session: TripSession,
  user: SmsUser,
): Promise<string> {
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

  const status = await handleStatus(admin, session);
  const msg = `We\u2019re back! \ud83d\ude4c\n${status}`;
  await announceDecision(admin, session.id, msg, user.id);
  return msg;
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

  track('sms_booking_confirmed', {
    distinct_id: session.id,
    sessionId: session.id,
    userId: user.id,
    kind: 'flight',
  }).catch(() => {});

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

  // ─── Noise gate: fast-path regex + Haiku classifier ──────────────────────
  // Categorizes the message into trip_decision / opt_out / reaction /
  // peer_chat / noise / unknown. Reactions, pure noise, and peer-chat are
  // silenced for Rally (they may still be used by ConversationParser
  // elsewhere). opt_out and trip_decision and unknown all fall through to
  // existing phase logic. See message-classifier.ts for category definitions.
  //
  // We SKIP the classifier during INTRO because every message there is an
  // introduction like "Hi I'm Julia" which is its own extraction pipeline,
  // and classifier calls would add unnecessary latency to onboarding.
  if (phase !== 'INTRO') {
    const participantsForClassify = await getParticipants(admin, session.id);
    const classification = await classifyMessage({
      admin,
      session,
      participants: participantsForClassify,
      body,
    });
    // Asterisk corrections: acknowledge so the sender knows we saw the fix,
    // even though we don't diff-apply it to prior state (PRD P5-5).
    // Only ack if there's a recent prior message from the same sender within
    // 2 minutes — otherwise it's a bare "*..." with no referent.
    if (
      classification.category === 'peer_chat' &&
      classification.reason === 'asterisk_correction'
    ) {
      const twoMinAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
      const { data: prior } = await admin
        .from('thread_messages')
        .select('body, created_at')
        .eq('trip_session_id', session.id)
        .eq('sender_phone', fromUser.phone)
        .eq('direction', 'inbound')
        .gte('created_at', twoMinAgo)
        .order('created_at', { ascending: false })
        .limit(2); // the current message is already stored, so take the 2nd
      const priorBody = prior?.[1]?.body ?? null;
      if (priorBody) {
        const snippet = priorBody.length > 30 ? priorBody.slice(0, 30).trim() + '…' : priorBody.trim();
        return `Got it — noted the correction to "${snippet}"`;
      }
      return null; // bare "*..." with no prior context
    }

    if (
      classification.category === 'reaction' ||
      classification.category === 'noise' ||
      classification.category === 'peer_chat'
    ) {
      return null;
    }
    // opt_out falls through to the graceful self-removal handler below.
    // trip_decision and unknown both fall through to phase-specific logic.
  }

  // During INTRO, collect names and destination ideas
  if (phase === 'INTRO') {
    // Check for "yes", "that's everyone", "we're good", "all here" to advance
    const introUpper = body.trim().toUpperCase();
    const participants = await getParticipants(admin, session.id);
    const namedCount = participants.filter((p) => p.display_name && p.status === 'active').length;
    const activeCount = participants.filter((p) => p.status === 'active').length;
    const isAdvanceSignal = introUpper === 'YES' || introUpper === 'YEP' || introUpper === 'YEAH' ||
        /\b(that'?s\s*everyone|we'?re\s*(all\s*)?good|all\s*here|that'?s\s*it|let'?s\s*go)\b/i.test(body);
    if (namedCount >= 2 && isAdvanceSignal) {
      // If some active participants haven't given names yet, wait briefly
      if (namedCount < activeCount) {
        const unnamedCount = activeCount - namedCount;
        return `Still waiting on ${unnamedCount} ${unnamedCount === 1 ? 'person' : 'people'} to drop ${unnamedCount === 1 ? 'their' : 'their'} name${unnamedCount === 1 ? '' : 's'}.`;
      }
      return advancePhase(admin, session);
    }

    // Name correction: "wait actually its X" / "actually I'm X" / "correction: X"
    // Applies when a participant already has a name and wants to change it
    const existingName = message.participant?.display_name;
    if (existingName) {
      const correctionMatch = body.match(/(?:wait\s+)?actually\s+(?:its?|i'?m|my\s+name\s+is)\s+([\p{L}][\p{L}'\-]{0,30})/iu)
        || body.match(/^correction[:\s]+([\p{L}][\p{L}'\-]{0,30})/iu);
      if (correctionMatch) {
        const newName = correctionMatch[1].trim();
        const properName = newName[0].toUpperCase() + newName.slice(1).toLowerCase();
        await admin.from('trip_session_participants')
          .update({ display_name: properName })
          .eq('trip_session_id', session.id)
          .eq('user_id', fromUser.id);
        await admin.from('users').update({ display_name: properName }).eq('id', fromUser.id);
        if (session.trip_id) {
          await admin.from('respondents').update({ name: properName })
            .eq('trip_id', session.trip_id).eq('phone', fromUser.phone);
        }
        return `Got it — ${properName} it is!`;
      }
    }

    // Extract name from "Name — destination" pattern (attempt on every INTRO message)
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

      // Add ALL recognized destinations from the message to candidates
      const destLower = destinationIdea.toLowerCase();
      const recognizedDests: string[] = [];
      const existingCandidates = ((session as Record<string, unknown>).destination_candidates as Array<{ label: string; votes: number }>) ?? [];
      for (const d of KNOWN_DESTINATIONS) {
        const re = new RegExp(`\\b${d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
        if (re.test(destLower)) {
          const properDest = d.split(' ').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
          if (!existingCandidates.some((c) => c.label.toLowerCase() === d)) {
            existingCandidates.push({ label: properDest, votes: 1 });
          }
          recognizedDests.push(properDest);
        }
      }
      if (recognizedDests.length > 0) {
        await admin
          .from('trip_sessions')
          .update({ destination_candidates: existingCandidates })
          .eq('id', session.id);

        const destListStr = recognizedDests.join(' and ');
        // Detect uncertainty — "idk", "not sure", "maybe", "possibly"
        const isUncertain = /\b(idk|not\s+sure|maybe|possibly|i\s+guess|could\s+be|might)\b/i.test(destinationIdea);

        const updatedP = await getParticipants(admin, session.id);
        const nowNamedD = updatedP.filter((p) => p.display_name && p.status === 'active').length;
        const everyonePrompt = nowNamedD >= 2 ? ' Is that everyone? Reply YES when the whole crew is here.' : '';
        if (isUncertain) {
          return `Got it, ${name} \u2014 ${destListStr} is on the list! Any other places you'd wanna explore?${everyonePrompt}`;
        }
        return `Got it, ${name} \u2014 ${destListStr} ${recognizedDests.length > 1 ? 'are' : 'is'} on the list!${everyonePrompt}`;
      }

      // Name extracted but no recognizable destination — just acknowledge name
      // Check if we have enough people to ask "is that everyone?"
      const updatedParticipants = await getParticipants(admin, session.id);
      const nowNamed = updatedParticipants.filter((p) => p.display_name && p.status === 'active').length;
      if (nowNamed >= 2) {
        return `Hey ${name}! Is that everyone? Reply YES when the whole crew is here.`;
      }
      return `Hey ${name}!`;
    }

    // Strip trailing emojis/symbols from text before parsing names
    const cleanBody = body.trim()
      .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}\ufe0f\u200d]+/gu, '')
      .replace(/[!?.,]+$/, '')
      .trim();

    // Natural-language name patterns:
    // "I'm X" / "Im X" / "It's X" / "Its X" / "this is X" / "hey hey abbey here" / "oh im ross btw"
    // Words that commonly appear AFTER a name but aren't part of it
    const NAME_SUFFIX_STOPWORDS = /^(btw|here|lol|haha|omg|etc|tho|though|yo)$/i;
    let extractedName: string | null = null;
    const naturalPatterns = [
      /(?:^|\s)(?:i'?m|im|my\s+name\s+is|this\s+is|its?)\s+([\p{L}][\p{L}'\-]{1,20}(?:\s+[\p{L}][\p{L}'\-]{0,20})?)/iu,
      /^(?:hey\s+hey\s+|hi+\s+|hello+\s+|yo\s+)?([\p{L}][\p{L}'\-]{1,20})\s+here\b/iu,
      /^it'?s\s+([\p{L}][\p{L}'\-]{1,20})/iu,
    ];
    for (const pat of naturalPatterns) {
      const m = cleanBody.match(pat);
      if (m) {
        // Strip trailing stopwords like "btw" from the captured name
        const captured = m[1].trim().split(/\s+/).filter((w) => !NAME_SUFFIX_STOPWORDS.test(w));
        if (captured.length > 0) {
          extractedName = captured.join(' ');
          break;
        }
      }
    }

    // Single-word or two-word name without dash ("Abbey", "Sofia", "Matt B")
    const NOT_NAMES = new Set([
      'lol', 'omg', 'wow', 'ok', 'okay', 'yes', 'no', 'yep', 'nah', 'nope',
      'haha', 'hahaha', 'lmao', 'lmfao', 'bruh', 'bro', 'dude', 'same',
      'nice', 'cool', 'sick', 'fire', 'bet', 'facts', 'cap', 'idk',
      'tbh', 'imo', 'fr', 'ngl', 'smh', 'rip', 'gg', 'yikes', 'oof',
      'hi', 'hey', 'yo', 'sup', 'sure', 'maybe', 'true', 'right',
      'what', 'huh', 'wait', 'why', 'how', 'who', 'when', 'where',
      'in', 'down', 'go', 'let', 'do', 'up', 'me', 'we', 'he', 'she',
      'whats', "what's", 'its', "it's", 'im', "i'm", 'thanks', 'ty',
    ]);
    const wordCountBody = cleanBody.split(/\s+/).length;
    if (!extractedName && wordCountBody <= 2 && /^[\p{L}]/u.test(cleanBody) && !/\d/.test(cleanBody) &&
        !NOT_NAMES.has(cleanBody.toLowerCase()) && !/^(haha|whats\s+up|sup\b)/i.test(cleanBody)) {
      extractedName = cleanBody;
    }

    if (extractedName) {
      // Normalize: title-case, strip trailing non-letters
      const parts = extractedName.split(/\s+/).filter(Boolean);
      const name = parts.map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(' ');

      await admin.from('trip_session_participants')
        .update({ display_name: name })
        .eq('trip_session_id', session.id)
        .eq('user_id', fromUser.id);
      await admin.from('users')
        .update({ display_name: name })
        .eq('id', fromUser.id);
      if (session.trip_id) {
        await admin.from('respondents')
          .update({ name })
          .eq('trip_id', session.trip_id)
          .eq('phone', fromUser.phone);
      }

      const updatedP = await getParticipants(admin, session.id);
      const nowNamed = updatedP.filter((p) => p.display_name && p.status === 'active').length;
      if (nowNamed >= 2) {
        return `Hey ${name}! Is that everyone? Reply YES when the whole crew is here.`;
      }
      return `Hey ${name}!`;
    }

    // #1 — Destination buried in natural language ("Tulum would be sick but idk")
    // If message is >3 words and contains alphabetic chars but didn't match the
    // "Name - Destination" pattern, check for destination mentions via simple keyword scan
    if (body.trim().split(/\s+/).length > 3 && /[a-zA-Z]/.test(body)) {
      const bodyLower = body.toLowerCase();
      for (const dest of KNOWN_DESTINATIONS) {
        // Use word boundary matching to prevent "la" matching inside "last", "place", etc.
        const destRegex = new RegExp(`\\b${dest.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
        if (destRegex.test(bodyLower)) {
          const properDest = dest.split(' ').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
          const existingCandidates = ((session as Record<string, unknown>).destination_candidates as Array<{ label: string; votes: number }>) ?? [];
          if (!existingCandidates.some((c) => c.label.toLowerCase() === dest)) {
            existingCandidates.push({ label: properDest, votes: 1 });
            await admin
              .from('trip_sessions')
              .update({ destination_candidates: existingCandidates })
              .eq('id', session.id);
            return `Heard ${properDest} \u2014 adding it to the list!`;
          }
          break;
        }
      }
    }

    return null;
  }

  // ─── RESET confirmation (must check before phase handlers) ──────────────
  const resetSubState = (session as Record<string, unknown>).phase_sub_state as string | null;
  if (resetSubState === 'RESET_PENDING' && body.trim().toUpperCase() === 'YES') {
    return handleResetConfirm(admin, session);
  }
  if (resetSubState === 'RESET_PENDING' && body.trim().toUpperCase() === 'NO') {
    await admin.from('trip_sessions').update({
      phase_sub_state: null,
      updated_at: new Date().toISOString(),
    }).eq('id', session.id);
    return 'Reset cancelled \u2014 carrying on.';
  }

  // ─── Pre-fill confirmation (must check before phase handlers) ──────────
  if (resetSubState === 'PREFILL_CONFIRMATION' && message.participant) {
    const isConfirm = /^(y(a+|e+)?s+|yep|yup|yeah+|works?|good|perfect|down|sounds?\s*good|i.?m\s*good|i.?m\s*down|let.?s\s*do\s*it|bet|same|locked|confirmed?)$/i.test(body.trim());
    if (isConfirm) {
      await admin.from('trip_session_participants')
        .update({ phase_confirmation: 'PREFILL_CONFIRMED' })
        .eq('id', message.participant.id);

      const { data: allP } = await admin
        .from('trip_session_participants')
        .select('phase_confirmation')
        .eq('trip_session_id', session.id)
        .eq('status', 'active');
      const confirmed = (allP ?? []).filter((p: { phase_confirmation?: string }) => p.phase_confirmation === 'PREFILL_CONFIRMED').length;
      const total = (allP ?? []).length;

      if (confirmed >= total) {
        await admin.from('trip_sessions').update({ phase_sub_state: null }).eq('id', session.id);
        await admin.from('trip_session_participants').update({ phase_confirmation: null }).eq('trip_session_id', session.id);
        const { data: freshS } = await admin.from('trip_sessions').select('*').eq('id', session.id).single();
        if (freshS) {
          const nextMsg = await advancePhase(admin, freshS);
          return nextMsg ? `Confirmed! ${nextMsg}` : 'Confirmed! Moving on.';
        }
      }
      return `${message.participant.display_name ?? 'Got it'} \u2014 ${confirmed}/${total} confirmed.`;
    }
    // Non-confirmation — could be a suggestion or disagreement. Stay silent and let them discuss.
    // Planner can NEXT to skip.
    return null;
  }

  // ─── Personality intercepts (no LLM needed) ─────────────────────────────
  const lower = body.trim().toLowerCase();
  const wordCount = body.trim().split(/\s+/).length;

  // ─── Graceful self-removal (P1-2) ──────────────────────────────────────
  // Detect "I won't be able to make it", "have to remove myself", "I'm out",
  // "count me out", "sadly out" etc. WITHOUT requiring STOP keyword.
  // Mark as opted_out but send a warm farewell instead of the harsh STOP response.
  // "I'm out" only matches as opt-out when NOT followed by "of [activity/noun phrase]"
  // e.g. "I'm out" = opt-out, but "out of snow activities" or "out of town" = NOT opt-out
  const gracefulOptOutPattern = /\b(won'?t\s+be\s+able\s+to\s+make\s+it|have\s+to\s+remove\s+myself|(?:i'?m|i\s+am)\s+(?:(?:sadly|also|definitely|probably)\s+)?out(?!\s+(?:of|for)\b)|count\s+me\s+out|can'?t\s+(?:make\s+it|come|go|do\s+it)|not\s+(?:gonna|going\s+to)\s+(?:make\s+it|be\s+able)|have\s+to\s+(?:bow\s+out|drop\s+out|sit\s+this\s+one\s+out|pass)|gotta\s+(?:pass|bow\s+out|sit\s+out)|sadly\s+(?:i\s+)?can'?t|i'?m\s+definitely\s+out|don'?t\s+think\s+i'?m\s+(?:gonna|going\s+to)\s+make\s+it)\b/i;
  if (gracefulOptOutPattern.test(body) && message.participant) {
    // Make sure this isn't partial availability ("I'm out for the first two weeks")
    const partialPattern = /\b(?:i'?m|i\s+am)\s+(?:sadly\s+)?out\s+(?:for|of)\s+(?:the\s+first|the\s+last|the\s+second|the\s+third)/i;
    if (!partialPattern.test(body)) {
      await admin
        .from('trip_session_participants')
        .update({ status: 'opted_out' })
        .eq('trip_session_id', session.id)
        .eq('user_id', fromUser.id);

      track('sms_opt_out', {
        distinct_id: session.id,
        sessionId: session.id,
        userId: fromUser.id,
        via: 'graceful_phrase',
      }).catch(() => {});

      const name = fromUser.display_name ?? 'friend';
      return `${name} — got it, we'll miss you!`;
    }
  }

  // ─── Scattered silence filters now handled by message-classifier.ts ────
  // (compliments, third-party status, emotional reactions, peer-to-peer chat,
  // during-trip logistics, property questions, activity coordination,
  // self-resolved questions, asterisk corrections, off-topic, farewells)

  // ─── P3-2: Budget info embedded in message — extract and store ──────────
  // "flights ~$325 and villa ~$550/person", "$200 pp for the weekend"
  const budgetMentions = [...body.matchAll(/\$\s*([\d,]+(?:\.\d{2})?)/g)];
  if (budgetMentions.length > 0 && /\b(flight|villa|hotel|airbnb|lodging|per\s*person|pp|person|total)\b/i.test(body)) {
    const amounts = budgetMentions.map(m => parseFloat(m[1].replace(',', ''))).filter(a => !isNaN(a) && a > 0);
    if (amounts.length > 0) {
      const totalPerPerson = amounts.reduce((sum, a) => sum + a, 0);
      // Store as preliminary budget if no budget set yet
      const { data: freshS } = await admin.from('trip_sessions').select('budget_median, budget_status').eq('id', session.id).single();
      if (freshS && !freshS.budget_median) {
        await admin.from('trip_sessions').update({
          budget_median: totalPerPerson,
          budget_status: 'ALIGNED',
          updated_at: new Date().toISOString(),
        }).eq('id', session.id);
      }
    }
  }

  // ─── P3-4/P3-5: Destination mentions during non-INTRO phases ───────────
  // Recognize new destination candidates at any point in the planning process.
  // (INTRO is already handled and returned above; control reaches here only
  // for non-INTRO phases.)
  {
    const bodyLower = body.toLowerCase();
    for (const dest of KNOWN_DESTINATIONS) {
      const destRegex = new RegExp(`\\b${dest.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (destRegex.test(bodyLower)) {
        const properDest = dest.split(' ').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
        const { data: freshS } = await admin.from('trip_sessions').select('destination_candidates').eq('id', session.id).single();
        const existingCandidates = (freshS?.destination_candidates as Array<{ label: string; votes: number }>) ?? [];
        if (!existingCandidates.some((c) => c.label.toLowerCase() === dest)) {
          existingCandidates.push({ label: properDest, votes: 1 });
          await admin.from('trip_sessions').update({
            destination_candidates: existingCandidates,
            updated_at: new Date().toISOString(),
          }).eq('id', session.id);
          // Don't respond here — let the message continue through phase handling
          // The destination is silently tracked
        }
        break;
      }
    }
  }

  // #32 — Dismissive / "shut up" messages (short, directed at Rally)
  if (wordCount <= 6 && /\b(shut\s*up|stop\s*talking|be\s*quiet|stfu|you'?re\s*annoying|go\s*away)\b/i.test(body)) {
    return "Noted. I'll keep it tight. Hit STATUS when you need me.";
  }

  // #38 — Bot-identity questions
  if (/\b(are\s*you\s*(a\s*)?bot|are\s*you\s*(an?\s*)?ai|are\s*you\s*real|are\s*you\s*human)\b/i.test(body)) {
    return "I'm Rally \u2014 part bot, part trip-planning legend. What do you need?";
  }

  // #39 — Casual / off-topic conversation
  if (/\b(how\s*are\s*you|what'?s\s*your\s*fav(ou?rite)?|tell\s*me\s*about\s*yourself|what\s*do\s*you\s*do|who\s*are\s*you|what\s*are\s*you)\b/i.test(body) && wordCount <= 10) {
    return "I'm great when groups are booking trips! What's next for yours?";
  }

  // #46 — Participant calls out confusing message ("wait what does that mean")
  if (wordCount <= 8 && /\b(what\s*does\s*that\s*mean|i\s*don'?t\s*understand|what\??$|huh\??$|confused)\b/i.test(lower)) {
    return "My bad \u2014 text STATUS for a summary of where we're at.";
  }

  // Commit poll — YES/NO during COMMIT_POLL phase
  if (phase === 'COMMIT_POLL' && message.participant && message.participant.status === 'active') {
    const upper = body.trim().toUpperCase();
    if (upper === 'YES' || upper === 'NO') {
      const result = await handleCommitResponse(
        admin, session, message.participant, upper.toLowerCase() as 'yes' | 'no',
      );
      if (result) return result;
      return null; // Still collecting
    }
    // P6-1: Ambiguous commitments — "I might be in", "maybe", "probably"
    if (/\b(?:i\s+might|maybe|i'?m\s+(?:not\s+sure|thinking|considering)|probably|possibly|i\s+think\s+(?:i\s+might|so))\b/i.test(body)) {
      const name = fromUser.display_name ?? 'Hey';
      return `${name} — need a firm YES or NO so we can finalize the headcount!`;
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
    const upperBody = body.trim().toUpperCase();
    const subState = (session as Record<string, unknown>).phase_sub_state as string | null;

    // SKIP — planner or anyone can skip dates entirely
    if (upperBody === 'SKIP') {
      const nextMsg = await advancePhase(admin, session);
      return nextMsg ?? 'Dates skipped \u2014 moving on.';
    }

    // Confirmation matching — expanded to catch common variants
    const isConfirmation = /^(y(a+|e+)?s+|yep|yup|yeah+|works?|good|perfect|same|down|done|totally|absolutely|for sure|def(initely)?|100%?|bet|sounds? good|works for me|i.?m good|that works|i.?m down|let.?s do it|same here|all good|i.?m in|locked)$/i.test(body.trim());

    // Check if this is a confirmation when dates have been proposed
    if (subState === 'DATES_PROPOSED' && session.dates && isConfirmation) {
      await admin.from('trip_session_participants')
        .update({ phase_confirmation: 'DATE_CONFIRMED' })
        .eq('id', message.participant.id);
      // Check how many have confirmed
      const { data: allP } = await admin
        .from('trip_session_participants')
        .select('phase_confirmation')
        .eq('trip_session_id', session.id)
        .eq('status', 'active');
      const confirmed = (allP ?? []).filter((p: { phase_confirmation?: string }) => p.phase_confirmation === 'DATE_CONFIRMED').length;
      const total = (allP ?? []).length;
      if (confirmed >= total) {
        // Clear sub_state and advance
        await admin.from('trip_sessions').update({
          phase_sub_state: null,
          updated_at: new Date().toISOString(),
        }).eq('id', session.id);
        await admin.from('trip_session_participants')
          .update({ phase_confirmation: null })
          .eq('trip_session_id', session.id);
        const nextMsg = await advancePhase(admin, session, fromUser.id);
        const dateMsg = `Dates locked in!`;
        const fullMsg = nextMsg ? dateMsg + '\n\n' + nextMsg : dateMsg;
        // Broadcast just the lock-in announcement; the next-phase prompt is
        // already broadcast separately by phase-flow.ts via announceTransition.
        await announceDecision(admin, session.id, dateMsg, fromUser.id);
        return fullMsg;
      }
      const dateLabel = formatSessionDates(session);
      return `${message.participant.display_name ?? 'Got it'} \u2014 ${dateLabel} ${confirmed}/${total} confirmed. Waiting on the rest.`;
    }

    // Try "weekend of M/D" format (e.g. "weekend of 9/12", "wknd of 9/5")
    const weekendMatch = body.match(/(?:week\s*end|wknd|wkd)\s+(?:of\s+)?(\d{1,2})\/(\d{1,2})/i);
    if (weekendMatch) {
      const wMonth = parseInt(weekendMatch[1]) - 1; // 0-indexed
      const wDay = parseInt(weekendMatch[2]);
      const year = new Date().getFullYear();
      // Calculate the weekend: find the Friday-Sunday around this date
      const anchor = new Date(year, wMonth, wDay);
      if (anchor < new Date()) anchor.setFullYear(year + 1);
      const dow = anchor.getDay(); // 0=Sun, 6=Sat
      const fri = new Date(anchor);
      fri.setDate(anchor.getDate() - ((dow + 2) % 7)); // back to Friday
      const sun = new Date(fri);
      sun.setDate(fri.getDate() + 2); // Sunday
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const friStr = fri.toISOString().split('T')[0];
      const sunStr = sun.toISOString().split('T')[0];
      const nights = 2;
      const monthLabel = months[fri.getMonth()];
      const dateLabel = `${monthLabel} ${fri.getDate()}–${sun.getDate()}`;

      // Check if this is an alternative date (P1-3) — "also", "or", "flexible"
      const isAlternative = /\b(also|or\b|flexible|alternatively|another\s+option)\b/i.test(body);
      if (isAlternative && subState === 'DATES_PROPOSED' && session.dates) {
        // Store as an alternative date option on the session deadlines field
        const existingAlts = ((session as Record<string, unknown>).deadlines as Array<{ start: string; end: string; label: string }>) ?? [];
        existingAlts.push({ start: friStr, end: sunStr, label: dateLabel });
        await admin.from('trip_sessions').update({
          deadlines: existingAlts,
          updated_at: new Date().toISOString(),
        }).eq('id', session.id);
        return `Also noted ${dateLabel} as an option. We'll figure out which works best.`;
      }

      // Store as the primary proposal
      await admin.from('trip_sessions').update({
        dates: { start: friStr, end: sunStr, nights },
        phase_sub_state: 'DATES_PROPOSED',
        updated_at: new Date().toISOString(),
      }).eq('id', session.id);
      await admin.from('trip_session_participants').update({ phase_confirmation: null }).eq('trip_session_id', session.id);
      await admin.from('trip_session_participants').update({ phase_confirmation: 'DATE_CONFIRMED' }).eq('id', message.participant.id);

      const { data: allP } = await admin.from('trip_session_participants').select('id').eq('trip_session_id', session.id).eq('status', 'active');
      const total = (allP ?? []).length;
      if (total <= 1) {
        await admin.from('trip_sessions').update({ phase_sub_state: null }).eq('id', session.id);
        const nextMsg = await advancePhase(admin, session);
        const dateMsg = `Got it — ${dateLabel} (${nights} nights).`;
        return nextMsg ? dateMsg + '\n\n' + nextMsg : dateMsg;
      }
      return `${dateLabel} (${nights} nights) — everyone good? Reply YES to lock it in, or suggest different dates.`;
    }

    // P3-1: Check for MULTIPLE date ranges in one message ("Nov 8-12? maybe Nov 12-16?")
    const allDateMatches = [...body.matchAll(/(\w+)\s+(\d{1,2})\s*[-\u2013to]+\s*(\d{1,2})/gi)];
    const MONTH_MAP: Record<string, number> = {
      jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2,
      apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6,
      aug: 7, august: 7, sep: 8, september: 8, oct: 9, october: 9,
      nov: 10, november: 10, dec: 11, december: 11,
    };
    if (allDateMatches.length >= 2) {
      // Multiple date ranges found — create options and ask group to vote
      const dateOptions: Array<{ start: string; end: string; label: string }> = [];
      for (const dm of allDateMatches) {
        const mStr = dm[1];
        const sDay = parseInt(dm[2]);
        const eDay = parseInt(dm[3]);
        const mNum = MONTH_MAP[mStr.toLowerCase()];
        if (mNum === undefined || sDay <= 0 || eDay <= 0) continue;
        const yr = new Date().getFullYear();
        const s = new Date(yr, mNum, sDay);
        const e = new Date(yr, mNum, eDay);
        if (s < new Date()) { s.setFullYear(yr + 1); e.setFullYear(yr + 1); }
        dateOptions.push({
          start: s.toISOString().split('T')[0],
          end: e.toISOString().split('T')[0],
          label: `${mStr} ${sDay}–${eDay}`,
        });
      }
      if (dateOptions.length >= 2) {
        // Store both options and create a date vote
        await admin.from('trip_sessions').update({
          deadlines: dateOptions,
          phase_sub_state: 'DATES_PROPOSED',
          dates: { start: dateOptions[0].start, end: dateOptions[0].end, nights: Math.round((new Date(dateOptions[0].end).getTime() - new Date(dateOptions[0].start).getTime()) / (24*60*60*1000)) },
          updated_at: new Date().toISOString(),
        }).eq('id', session.id);
        const labels = dateOptions.map(o => o.label);
        return `A few date options:\n${labels.map((l, i) => `${i+1}. ${l}`).join('\n')}\n\nWhich works best? Vote by number or suggest your own.`;
      }
    }

    // Try regex first for exact dates (e.g. "Nov 8-12", "Jan 15-19")
    const dateMatch = body.match(/(\w+)\s+(\d{1,2})\s*[-\u2013to]+\s*(\d{1,2})/i);
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

        // If dates already proposed and this matches, treat as confirmation
        if (subState === 'DATES_PROPOSED' && session.dates) {
          const existingStart = (session.dates as { start?: string }).start;
          const existingEnd = (session.dates as { start?: string; end?: string }).end;
          if (existingStart === startStr && existingEnd === endStr) {
            // Same dates — treat as a confirmation
            await admin.from('trip_session_participants')
              .update({ phase_confirmation: 'DATE_CONFIRMED' })
              .eq('id', message.participant.id);
            const { data: allPCheck } = await admin
              .from('trip_session_participants')
              .select('phase_confirmation')
              .eq('trip_session_id', session.id)
              .eq('status', 'active');
            const confirmedCount = (allPCheck ?? []).filter((p: { phase_confirmation?: string }) => p.phase_confirmation === 'DATE_CONFIRMED').length;
            const totalCount = (allPCheck ?? []).length;
            if (confirmedCount >= totalCount) {
              await admin.from('trip_sessions').update({ phase_sub_state: null }).eq('id', session.id);
              await admin.from('trip_session_participants').update({ phase_confirmation: null }).eq('trip_session_id', session.id);
              const nextMsg = await advancePhase(admin, session, fromUser.id);
              const lockMsg = `Dates locked in!`;
              await announceDecision(admin, session.id, lockMsg, fromUser.id);
              return nextMsg ? `${lockMsg}\n\n${nextMsg}` : lockMsg;
            }
            const dateLabel2 = formatSessionDates(session);
            return `${message.participant.display_name ?? 'Got it'} \u2014 ${dateLabel2} ${confirmedCount}/${totalCount} confirmed.`;
          }
          // Different dates proposed — check if it's an alternative (P1-3)
          const isAltDate = /\b(also|or\b|flexible|alternatively|another\s+option)\b/i.test(body);
          if (isAltDate) {
            const existingAlts = ((session as Record<string, unknown>).deadlines as Array<{ start: string; end: string; label: string }>) ?? [];
            existingAlts.push({ start: startStr, end: endStr, label: `${monthStr} ${startDay}–${endDay}` });
            await admin.from('trip_sessions').update({
              deadlines: existingAlts,
              updated_at: new Date().toISOString(),
            }).eq('id', session.id);
            return `Also noted ${monthStr} ${startDay}–${endDay} as an option. We'll figure out which works best.`;
          }
        }

        // Store proposed dates on session but DON'T advance yet — wait for group confirmation
        await admin.from('trip_sessions').update({
          dates: { start: startStr, end: endStr, nights },
          phase_sub_state: 'DATES_PROPOSED',
          updated_at: new Date().toISOString(),
        }).eq('id', session.id);
        // Reset everyone's confirmation since dates changed
        await admin.from('trip_session_participants')
          .update({ phase_confirmation: null })
          .eq('trip_session_id', session.id);
        await admin.from('trip_session_participants')
          .update({ phase_confirmation: 'DATE_CONFIRMED' })
          .eq('id', message.participant.id);
        // Check total participants
        const { data: allP } = await admin
          .from('trip_session_participants')
          .select('id')
          .eq('trip_session_id', session.id)
          .eq('status', 'active');
        const total = (allP ?? []).length;
        if (total <= 1) {
          // Solo planner — advance immediately
          await admin.from('trip_sessions').update({ phase_sub_state: null }).eq('id', session.id);
          const nextMsg = await advancePhase(admin, session);
          const dateMsg = `Got it \u2014 ${monthStr} ${startDay}\u2013${endDay} (${nights} nights).`;
          return nextMsg ? dateMsg + '\n\n' + nextMsg : dateMsg;
        }
        return `${monthStr} ${startDay}\u2013${endDay} (${nights} nights) \u2014 everyone good? Reply YES to lock it in, or suggest different dates.`;
      }
    }

    // P1-4: Partial availability — "out for the first two weeks of sept" is a constraint, not opt-out
    const partialAvailMatch = /\b(?:out|busy|unavailable|away|gone|traveling)\s+(?:for\s+)?(?:the\s+)?(?:first|last|second|third|beginning|end)\s+(?:\w+\s+)?(?:weeks?|wks?|days?|half)\s+(?:of\s+|for\s+|in\s+)?(\w+)/i.test(body);
    if (partialAvailMatch && message.participant) {
      const currentPC = (await admin
        .from('trip_session_participants')
        .select('phase_confirmation')
        .eq('id', message.participant.id)
        .single()).data?.phase_confirmation;
      if (currentPC !== 'DATE_CONFIRMED') {
        await admin
          .from('trip_session_participants')
          .update({ budget_raw: `CONSTRAINT: ${body.trim()}` })
          .eq('id', message.participant.id);
      }
      const name = fromUser.display_name ?? 'Got it';
      return `${name} — noted, we'll work around that.`;
    }

    // Only store as date input if it really looks like date content.
    // Previously this matched any message containing "week", "month", or a
    // 1-2 digit number, which caused off-topic lines like "broke my arm this
    // week" to get stored + acknowledged. Now we require either:
    //   (a) a month name AND a day number (e.g. "Nov 12", "sept 5-9"), OR
    //   (b) an explicit season/holiday phrase on its own
    //       ("christmas", "new year", "thanksgiving", "spring break",
    //        "labor day weekend", etc.)
    const hasMonth = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december)\b/i.test(body);
    const hasDayNumber = /\b\d{1,2}(?:st|nd|rd|th)?\b/.test(body);
    const hasSeasonOrHoliday = /\b(?:christmas|thanksgiving|new\s*year(?:'s)?|spring\s+break|labor\s+day|memorial\s+day|fourth\s+of\s+july|4th\s+of\s+july|summer|fall|winter|spring)\s*(?:break|weekend|holiday)?\b/i.test(body);
    const looksLikeDateContent = (hasMonth && hasDayNumber) || hasSeasonOrHoliday;
    const currentPhaseConfirm = message.participant ? (await admin
      .from('trip_session_participants')
      .select('phase_confirmation')
      .eq('id', message.participant.id)
      .single()).data?.phase_confirmation : null;

    // Don't overwrite DATE_CONFIRMED status with raw date text
    if (looksLikeDateContent && currentPhaseConfirm !== 'DATE_CONFIRMED') {
      await admin
        .from('trip_session_participants')
        .update({ budget_raw: body.trim() })
        .eq('id', message.participant.id);
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
                return `A few date options came up!\n\n` + formatPollMessage('Vote on dates:', labels);
              }
            } else {
              return `Sounds like no one's locked in dates yet. Can someone nail down specific dates? Like "Apr 17-20"`;
            }
          } catch { /* fall through */ }
        }
      }

      return "Got everyone's input on dates. Can someone nail down the exact dates? Like \"Apr 17-20\"";
    }

    // Only acknowledge messages that look date-related. Stay silent on off-topic chatter.
    if (looksLikeDateContent) {
      const name = fromUser.display_name ?? 'Got it';
      return `${name} \u2014 noted.`;
    }

    // Off-topic during DECIDING_DATES — stay silent
    return null;
  }

  // Origin collection during COLLECTING_ORIGINS
  if (phase === 'COLLECTING_ORIGINS' && message.participant) {
    const origin = body.trim();

    // Skip common phrases that aren't origins
    const NOT_ORIGINS = /^(that'?s\s*everyone|we'?re\s*(all\s*)?good|all\s*here|let'?s\s*go|that'?s\s*it|yes|no|ok|okay|sure|same|nice|lol|haha|omg|sounds?\s*good|works|perfect|done|ready)$/i;
    if (NOT_ORIGINS.test(origin)) {
      return null; // Silently ignore non-origin phrases
    }

    // Store the origin (city or airport code) — must be 2-50 chars
    if (origin.length >= 2 && origin.length <= 50 && origin.split(/\s+/).length <= 4) {
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
      // Show X/Y progress like dates confirmation does
      const allOriginP = await getParticipants(admin, session.id);
      const activeOriginP = allOriginP.filter((p) => p.status === 'active');
      const submittedCount = activeOriginP.filter((p) => p.origin_airport || p.origin_city || p.user_id === fromUser.id).length;
      const totalCount = activeOriginP.length;
      return `${name} \u2014 ${origin}. ${submittedCount}/${totalCount} replied. Waiting on the rest.`;
    }
  }

  // Flight status collection during AWAITING_FLIGHTS
  if (phase === 'AWAITING_FLIGHTS' && message.participant) {
    const upper = body.trim().toUpperCase();

    // P4-3: Detect varied booking confirmations
    const isBookingConfirmation = /\b(?:i\s+booked|mine\s+(?:are\s+)?(?:actually\s+)?booked|(?:i'?ve|i\s+have)\s+booked|flights?\s+(?:are\s+)?booked|just\s+booked|already\s+booked)\b/i.test(body)
      && !/\b(?:did\s+you|can\s+we|gonna|going\s+to|plan\s+to|about\s+to|want\s+to)\b/i.test(body);
    // "I may or may not have also booked" — playful but means booked
    const isPlayfulBooked = /\bi\s+may\s+or\s+may\s+not\s+have\s+(?:also\s+)?booked\b/i.test(body);
    // Future intent — NOT booked: "gonna book tn", "down to book tonight", "planning to book"
    const isFutureIntent = /\b(?:gonna|going\s+to|plan(?:ning)?\s+to|about\s+to|down\s+to|want\s+to|need\s+to)\s+book\b/i.test(body);

    if ((isBookingConfirmation || isPlayfulBooked) && !isFutureIntent) {
      await admin
        .from('trip_session_participants')
        .update({ flight_status: 'confirmed' })
        .eq('id', message.participant.id);
      const name = fromUser.display_name ?? 'Someone';
      return `${name}'s flights are locked in \ud83d\udd12 who's next?`;
    }

    // P4-5: "can someone send me the flights" — request for info, stay silent
    if (/\b(?:can\s+someone\s+send|send\s+me\s+the\s+flights?|share\s+the\s+(?:flights?|link))\b/i.test(body)) {
      return null;
    }

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

  // #34: Sub-group booking detection — Rally only splits for the whole group
  if (/\b(just\s+me\s+and\s+\w+|only\s+\d+\s+of\s+us|just\s+us\s+two|just\s+the\s+two\s+of\s+us)\b/i.test(body)) {
    const subNameMatch = body.match(/just\s+me\s+and\s+(\w+)/i);
    const subName = subNameMatch ? subNameMatch[1] : 'them';
    return `I can only split for the whole group \u2014 you and ${subName} can sort that one between yourselves.`;
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

      const bookMsg = `You're booked! \u{1F389} ${property} for $${cost} total ($${perPerson}/person for ${committed.length}).`;
      await announceDecision(admin, session.id, bookMsg, fromUser.id);
      return bookMsg;
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

        const everyoneBookedMsg = "Everyone's booked! \u{1F389} First booking is locked. Trip is happening!";
        await announceDecision(admin, session.id, everyoneBookedMsg, fromUser.id);
        return everyoneBookedMsg;
      }

      const name = fromUser.display_name ?? 'Someone';
      return `${name} is sorted \u{2705}`;
    }
  }

  // Budget poll phase — handle budget responses (only when no vote poll is open)
  if (phase === 'BUDGET_POLL' && message.participant && !(session as Record<string,unknown>).current_poll_id) {
    const budgetUpper = body.trim().toUpperCase();

    // READY — resolve disputed budget by finding lowest amount from discussion
    if (budgetUpper === 'READY') {
      const { data: freshS } = await admin.from('trip_sessions').select('budget_status').eq('id', session.id).single();
      if (freshS?.budget_status === 'DISPUTED') {
        const { data: recentMsgs } = await admin
          .from('thread_messages')
          .select('body')
          .eq('trip_session_id', session.id)
          .eq('direction', 'inbound')
          .order('created_at', { ascending: false })
          .limit(20);

        const amounts: number[] = [];
        for (const m of recentMsgs ?? []) {
          for (const match of m.body.matchAll(/\$\s*([\d,]+(?:\.\d{2})?)/g)) {
            const val = parseFloat(match[1].replace(',', ''));
            if (!isNaN(val) && val > 0 && val < 100000) amounts.push(val);
          }
        }

        if (amounts.length > 0) {
          const lowest = Math.min(...amounts);
          await admin.from('trip_sessions').update({
            budget_median: lowest,
            budget_status: 'ALIGNED',
            updated_at: new Date().toISOString(),
          }).eq('id', session.id);

          const { data: updS } = await admin.from('trip_sessions').select('*').eq('id', session.id).single();
          const nextMsg = updS ? await advancePhase(admin, updS, fromUser.id) : null;
          const readyMsg = `Budget set to $${lowest}/person. Moving on.`;
          await announceDecision(admin, session.id, readyMsg, fromUser.id);
          return nextMsg ? readyMsg + '\n\n' + nextMsg : readyMsg;
        }
        return "I didn't catch a specific number from the discussion. Planner can text BUDGET SET $[amount] to lock it in.";
      }
    }

    // BUDGET SET $[amount] — planner override
    const budgetSetMatch = body.match(/^budget\s+set\s+\$?([\d,]+(?:\.\d{2})?)/i);
    if (budgetSetMatch) {
      const isPlanner = fromUser.id === session.planner_user_id || message.participant?.is_planner;
      if (!isPlanner) {
        const plannerName = await getPlannerName(admin, session);
        return `Only the planner (${plannerName}) can set the budget.`;
      }
      const bAmount = parseFloat(budgetSetMatch[1].replace(',', ''));
      if (isNaN(bAmount) || bAmount <= 0) return 'Invalid amount. Try: BUDGET SET $1000';

      await admin.from('trip_sessions').update({
        budget_median: bAmount,
        budget_status: 'ALIGNED',
        updated_at: new Date().toISOString(),
      }).eq('id', session.id);

      const { data: updS } = await admin.from('trip_sessions').select('*').eq('id', session.id).single();
      const nextMsg = updS ? await advancePhase(admin, updS, fromUser.id) : null;
      const setMsg = `Budget locked at $${bAmount}/person.`;
      await announceDecision(admin, session.id, setMsg, fromUser.id);
      return nextMsg ? setMsg + '\n\n' + nextMsg : setMsg;
    }

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
    // Budget vote accepted but not all in — ack the individual vote
    // Check if this was actually a recognized budget response (not random chat)
    const { amount, skipped } = normalizeBudget(body);
    if (amount !== null || skipped) {
      const { data: freshP } = await admin
        .from('trip_session_participants')
        .select('budget_raw')
        .eq('trip_session_id', session.id)
        .eq('status', 'active');
      const voted = (freshP ?? []).filter((p) => p.budget_raw !== null).length;
      const total = (freshP ?? []).length;
      const name = fromUser.display_name ?? 'Got it';
      return `${name} \u2014 ${voted}/${total} voted.`;
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
  // If in DECIDING_DATES with proposed dates or pre-fill confirmation, clear sub_state
  const subState = (session as Record<string, unknown>).phase_sub_state as string | null;
  if (subState === 'PREFILL_CONFIRMATION') {
    await admin.from('trip_sessions').update({
      phase_sub_state: null,
      updated_at: new Date().toISOString(),
    }).eq('id', session.id);
    await admin.from('trip_session_participants')
      .update({ phase_confirmation: null })
      .eq('trip_session_id', session.id);
  }
  if (session.phase === 'DECIDING_DATES' && subState === 'DATES_PROPOSED') {
    await admin.from('trip_sessions').update({
      phase_sub_state: null,
      updated_at: new Date().toISOString(),
    }).eq('id', session.id);
    await admin.from('trip_session_participants')
      .update({ phase_confirmation: null, budget_raw: null })
      .eq('trip_session_id', session.id);
  }

  // COMMIT_POLL: planner can force-advance with whoever has committed
  if (session.phase === 'COMMIT_POLL') {
    const participants = await getParticipants(admin, session.id);
    const committed = participants.filter((p) => p.committed === true || p.flight_status === 'confirmed');
    const uncommitted = participants.filter((p) => p.status === 'active' && !p.committed && p.flight_status !== 'confirmed');

    if (committed.length === 0) {
      return "No one's committed yet \u2014 need at least one YES before advancing.";
    }

    // Mark uncommitted as dropped
    for (const p of uncommitted) {
      await admin.from('trip_session_participants')
        .update({ committed: false, flights_link_response: 'commit_no' })
        .eq('id', p.id);
    }

    // Store committed list and advance
    await admin.from('trip_sessions').update({
      committed_participants: committed.map((p) => ({
        user_id: p.user_id,
        phone: p.phone,
        display_name: p.display_name,
      })),
      phase: 'AWAITING_FLIGHTS',
      updated_at: new Date().toISOString(),
    }).eq('id', session.id);

    const droppedNames = uncommitted.map((p) => p.display_name ?? p.phone).join(', ');
    const msg = committed.length === participants.length
      ? "Everyone's in! Moving on to flights."
      : `Moving on with ${committed.length} of ${participants.length}. ${droppedNames ? droppedNames + ' didn\u2019t respond \u2014 they can rejoin later.' : ''}`;

    const fullMsg = msg + '\n\nHave you booked your flights? Reply YES, NOT YET, or DRIVING.';
    await announceDecision(admin, session.id, fullMsg, user.id);
    return fullMsg;
  }

  const result = await advancePhase(admin, session, user.id);
  return result ?? `Can't advance from ${session.phase} right now.`;
}

// ─── RESET handler ──────────────────────────────────────────────────────────

async function handleReset(
  admin: SupabaseClient,
  session: TripSession,
  user: SmsUser,
): Promise<string> {
  // Set sub_state to track that we're awaiting reset confirmation
  await admin.from('trip_sessions').update({
    phase_sub_state: 'RESET_PENDING',
    updated_at: new Date().toISOString(),
  }).eq('id', session.id);

  const msg = 'Reset everything? I\u2019ll keep the group but clear all decisions. Reply YES to confirm.';
  await announceDecision(admin, session.id, msg, user.id);
  return msg;
}

async function handleResetConfirm(
  admin: SupabaseClient,
  session: TripSession,
): Promise<string> {
  // Clear all session data and rewind to COLLECTING_DESTINATIONS
  await admin.from('trip_sessions').update({
    phase: 'COLLECTING_DESTINATIONS',
    phase_sub_state: null,
    destination: null,
    destination_candidates: null,
    dates: null,
    budget_median: null,
    budget_range: null,
    budget_status: null,
    cost_estimates: null,
    committed_participants: null,
    current_poll_id: null,
    deadlines: null,
    updated_at: new Date().toISOString(),
  }).eq('id', session.id);

  // Clear participant data (origins, budgets, commits) but keep names
  await admin.from('trip_session_participants').update({
    budget_raw: null,
    budget_normalized: null,
    phase_confirmation: null,
    origin_city: null,
    origin_airport: null,
    committed: null,
    flight_status: null,
    flights_link_response: null,
  }).eq('trip_session_id', session.id);

  // Re-advance from COLLECTING_DESTINATIONS
  const { data: freshSession } = await admin.from('trip_sessions').select('*').eq('id', session.id).single();
  if (freshSession) {
    const nextMsg = await advancePhase(admin, freshSession);
    if (nextMsg) return nextMsg;
  }

  return "Where are you thinking? Drop your destination ideas \u2014 we'll vote once everyone's weighed in.";
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
  // #64 — "PROPOSE dinner" (no dollar amount) fails parse, returns usage message
  const match = args.match(/\$?([\d,]+(?:\.\d{2})?)\s+(.+)/);
  if (!match) {
    return 'Usage: PROPOSE $[amount] [reason]\nExample: PROPOSE $110 Gitano Beach dinner';
  }

  const amount = parseFloat(match[1].replace(',', ''));
  const reason = match[2].trim();

  if (isNaN(amount)) return 'Could not parse amount. Try: PROPOSE $110 dinner';

  // #65 — Warn on implausibly high amounts (don't block)
  let result = await launchPropose(
    admin, session, user.id, user.display_name ?? user.phone, amount, reason,
  );
  if (amount > 10000) {
    result += `\n\nHeads up — that's $${amount} total. Make sure the amount is right.`;
  }

  return result;
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
