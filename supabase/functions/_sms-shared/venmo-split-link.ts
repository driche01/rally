/**
 * Component 14: VenmoSplitLink
 *
 * Handles all group expense splitting:
 *   - Lodging deposits (Phase 4 group booking)
 *   - Ad-hoc SPLIT command (any group expense)
 *   - PROPOSE flow (pre-payment → confirmation → SPLIT)
 *
 * Generates Venmo deep links per participant.
 * Tracks payment status via split_requests table.
 */
import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { TripSession, TripSessionParticipant } from './trip-session.ts';

// ─── SPLIT intent parsing ────────────────────────────────────────────────────

export interface SplitIntent {
  amount: number;
  ways: number | null; // null = use committed headcount
  reason: string;
}

/**
 * Parse a SPLIT command body.
 * Returns the parsed intent, or null if unparseable.
 */
export function parseSplitIntent(body: string): SplitIntent | null {
  const match = body.match(
    /(?:split\s+)?\$?([\d,]+(?:\.\d{2})?)\s*(?:(\d+)\s*ways?)?\s*(.+)?/i,
  );
  if (!match) return null;

  const amount = parseFloat(match[1].replace(',', ''));
  const ways = match[2] ? parseInt(match[2]) : null;
  const reason = match[3]?.trim() || 'group expense';

  return isNaN(amount) ? null : { amount, ways, reason };
}

// ─── Venmo link generation ───────────────────────────────────────────────────

function venmoDeepLink(recipientPhone: string, amount: number, note: string): string {
  const encoded = encodeURIComponent(note);
  return `venmo://paycharge?txn=pay&recipients=${recipientPhone}&amount=${amount}&note=${encoded}`;
}

function venmoWebLink(recipientPhone: string, amount: number, note: string): string {
  const encoded = encodeURIComponent(note);
  return `https://venmo.com/?txn=pay&recipients=${recipientPhone}&amount=${amount}&note=${encoded}`;
}

// ─── Split calculation ───────────────────────────────────────────────────────

// #73 — Handles odd splits (e.g. $307/8): rounds down per person, adds penny
// discrepancy to first participant so total is exact.
function calculateSplit(
  totalCost: number,
  participantCount: number,
): { amounts: number[]; perPerson: number } {
  const perPerson = Math.floor((totalCost / participantCount) * 100) / 100;
  const amounts = new Array(participantCount).fill(perPerson);

  // Add penny discrepancy to first participant
  const totalSplit = perPerson * participantCount;
  const diff = Math.round((totalCost - totalSplit) * 100) / 100;
  if (diff !== 0) amounts[0] = Math.round((amounts[0] + diff) * 100) / 100;

  return { amounts, perPerson };
}

// ─── Lodging split (Phase 4) ─────────────────────────────────────────────────

/**
 * Generate and send lodging Venmo split links.
 * Returns the summary message.
 */
export async function sendLodgingSplit(
  admin: SupabaseClient,
  session: TripSession,
  plannerPhone: string,
  plannerName: string,
  totalCost: number,
  stayingParticipants: TripSessionParticipant[],
  tripName: string,
): Promise<string> {
  const { perPerson, amounts } = calculateSplit(totalCost, stayingParticipants.length);
  const note = `Rally: ${tripName} lodging`;
  const messages: { body: string; delay_ms: number }[] = [];

  for (let i = 0; i < stayingParticipants.length; i++) {
    const p = stayingParticipants[i];
    const amt = amounts[i];
    const link = venmoDeepLink(plannerPhone, amt, note);
    const name = p.display_name ?? p.phone;

    messages.push({
      body: `${name}, your share is $${amt}. Venmo ${plannerName}: ${link}`,
      delay_ms: 2000,
    });

    // Write split_request for tracking
    await admin.from('split_requests').insert({
      trip_session_id: session.id,
      split_type: 'lodging',
      reason: 'lodging',
      recipient_user_id: session.planner_user_id,
      payer_user_id: p.user_id,
      amount: amt,
      status: 'pending',
      venmo_link: link,
    });
  }

  // Queue as a batch send
  await admin.from('outbound_message_queue').insert({
    trip_session_id: session.id,
    thread_id: session.thread_id,
    priority: 3,
    job_type: 'batch',
    messages: JSON.stringify(messages),
  });

  return `Venmo requests are out \u2014 $${perPerson}/person to ${plannerName}. Text PAID STATUS anytime to see who's settled.`;
}

// ─── Ad-hoc SPLIT ────────────────────────────────────────────────────────────

/**
 * Handle a SPLIT command from any participant.
 * #68 — Works in any phase; not tied to lodging. Any group expense can be split.
 * Returns the response message.
 */
export async function handleSplitCommand(
  admin: SupabaseClient,
  session: TripSession,
  requesterUserId: string,
  requesterPhone: string,
  requesterName: string,
  intent: SplitIntent,
): Promise<string> {
  // Get committed participants (or all active if no commit poll yet)
  const { data: participants } = await admin
    .from('trip_session_participants')
    .select('*')
    .eq('trip_session_id', session.id)
    .eq('status', 'active');

  if (!participants || participants.length === 0) {
    return 'No one to split with yet.';
  }

  const ways = intent.ways ?? participants.length;
  const { perPerson, amounts } = calculateSplit(intent.amount, ways);
  const note = `Rally: ${session.destination ?? 'trip'} ${intent.reason}`;

  // Exclude the requester from receiving a Venmo link (they paid)
  const payers = participants.filter((p) => p.user_id !== requesterUserId);
  const messages: { body: string; delay_ms: number }[] = [];

  for (let i = 0; i < payers.length; i++) {
    const p = payers[i];
    const amt = i < amounts.length ? amounts[i] : perPerson;
    const link = venmoDeepLink(requesterPhone, amt, note);
    const name = p.display_name ?? p.phone;

    messages.push({
      body: `${name}, your share is $${amt}. Venmo ${requesterName}: ${link}`,
      delay_ms: 2000,
    });

    await admin.from('split_requests').insert({
      trip_session_id: session.id,
      split_type: 'adhoc',
      reason: intent.reason,
      recipient_user_id: requesterUserId,
      payer_user_id: p.user_id,
      amount: amt,
      status: 'pending',
      venmo_link: link,
    });
  }

  // Queue batch send
  await admin.from('outbound_message_queue').insert({
    trip_session_id: session.id,
    thread_id: session.thread_id,
    priority: 3,
    job_type: 'batch',
    messages: JSON.stringify(messages),
  });

  const groupLink = venmoWebLink(requesterPhone, perPerson, note);
  return `Splitting $${intent.amount} for ${intent.reason} \u2014 $${perPerson}/person for ${ways} of you.\n\nPay ${requesterName}: ${groupLink}`;
}

// ─── PROPOSE flow ────────────────────────────────────────────────────────────

/**
 * Launch a PROPOSE request. Returns the distribution message.
 */
export async function launchPropose(
  admin: SupabaseClient,
  session: TripSession,
  proposerUserId: string,
  proposerName: string,
  amount: number,
  reason: string,
): Promise<string> {
  // Get committed participants count
  const { data: participants } = await admin
    .from('trip_session_participants')
    .select('id')
    .eq('trip_session_id', session.id)
    .eq('status', 'active')
    .eq('committed', true);

  const participantCount = participants?.length ?? 0;
  const perPerson = participantCount > 0 ? Math.round((amount / participantCount) * 100) / 100 : amount;

  const { data: proposal, error } = await admin
    .from('propose_requests')
    .insert({
      trip_session_id: session.id,
      proposer_user_id: proposerUserId,
      amount,
      per_person_amount: perPerson,
      reason,
      participant_count: participantCount,
      status: 'collecting',
      expires_at: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
    })
    .select('id')
    .single();

  if (error) throw new Error(`Failed to create proposal: ${error.message}`);

  return (
    `${proposerName} wants to book ${reason} for $${perPerson}/person \u2014 ` +
    `they'd prepay for the group. Everyone in? Reply YES or NO.`
  );
}

/**
 * Handle a PROPOSE YES/NO response.
 * Returns a message when threshold met, or null if still collecting.
 */
export async function handleProposeResponse(
  admin: SupabaseClient,
  session: TripSession,
  response: 'yes' | 'no',
): Promise<string | null> {
  // Find the open proposal
  const { data: proposal } = await admin
    .from('propose_requests')
    .select('*')
    .eq('trip_session_id', session.id)
    .eq('status', 'collecting')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!proposal) return null;

  const update = response === 'yes'
    ? { yes_count: (proposal.yes_count ?? 0) + 1 }
    : { no_count: (proposal.no_count ?? 0) + 1 };

  await admin.from('propose_requests').update(update).eq('id', proposal.id);

  const newYes = response === 'yes' ? update.yes_count! : proposal.yes_count ?? 0;
  const total = proposal.participant_count ?? 1;
  const threshold = Math.ceil(total * 0.8);

  if (newYes >= threshold) {
    await admin
      .from('propose_requests')
      .update({
        status: 'confirmed',
        confirmed_at: new Date().toISOString(),
        pay_by: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
      })
      .eq('id', proposal.id);

    return (
      `You're good to book \u2014 ${newYes} people are in. ` +
      `Once you've paid, text PAID and I'll send everyone their Venmo links.`
    );
  }

  return null; // Still collecting
}

/**
 * Handle PAID after a confirmed PROPOSE.
 * Triggers the split.
 */
export async function handleProposePaid(
  admin: SupabaseClient,
  session: TripSession,
  proposerUserId: string,
  proposerPhone: string,
  proposerName: string,
): Promise<string | null> {
  const { data: proposal } = await admin
    .from('propose_requests')
    .select('*')
    .eq('trip_session_id', session.id)
    .eq('proposer_user_id', proposerUserId)
    .eq('status', 'confirmed')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // #69 — If no matching proposal for this user, they're not the proposer
  if (!proposal) return 'Only the person who proposed can confirm payment.';

  await admin
    .from('propose_requests')
    .update({ status: 'paid', paid_at: new Date().toISOString() })
    .eq('id', proposal.id);

  // Trigger SPLIT with the proposal details
  return handleSplitCommand(admin, session, proposerUserId, proposerPhone, proposerName, {
    amount: proposal.amount,
    ways: proposal.participant_count,
    reason: proposal.reason ?? 'group expense',
  });
}

/**
 * Handle CANCEL on a PROPOSE request.
 * #74 — Blocks cancel after payment, allows cancel of confirmed proposals.
 */
export async function handleProposeCancel(
  admin: SupabaseClient,
  session: TripSession,
  proposerUserId: string,
): Promise<string | null> {
  const { data: proposal } = await admin
    .from('propose_requests')
    .select('*')
    .eq('trip_session_id', session.id)
    .eq('proposer_user_id', proposerUserId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!proposal) return null;

  if (proposal.status === 'paid') {
    return "That's already been paid \u2014 you'll need to sort refunds directly.";
  }

  if (proposal.status === 'confirmed' || proposal.status === 'collecting') {
    await admin
      .from('propose_requests')
      .update({ status: 'cancelled' })
      .eq('id', proposal.id);

    return `Proposal for ${proposal.reason ?? 'group expense'} has been cancelled.`;
  }

  return null;
}
