/**
 * Component 9: CommitPollEngine
 *
 * Manages the commit poll, outcome branching, and new thread creation
 * when the group splits.
 *
 * Combined celebration + commit message (destination locked → "who's in?").
 * Auto-marks participants with flight_status='confirmed' as committed.
 */
import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { TripSession, TripSessionParticipant } from './trip-session.ts';
import { deriveThreadId } from './thread.ts';
import { generateCelebration, enterCelebrationMode } from './bot-response-generator.ts';

// ─── Commit poll dispatch ────────────���───────────────────────────────────────

/**
 * Launch the commit poll as part of the destination celebration.
 * Returns the celebration + commit message.
 */
export async function launchCommitPoll(
  admin: SupabaseClient,
  session: TripSession,
  participants: TripSessionParticipant[],
): Promise<string> {
  // Auto-mark flight-confirmed participants as committed
  const autoCommitted: string[] = [];
  for (const p of participants) {
    if (p.flight_status === 'confirmed' && !p.committed) {
      await admin
        .from('trip_session_participants')
        .update({ committed: true })
        .eq('id', p.id);
      autoCommitted.push(p.display_name ?? p.phone);
    }
  }

  // Check if 70%+ are already committed (skip formal poll)
  const activeCount = participants.filter((p) => p.status === 'active').length;
  const committedCount = participants.filter((p) => p.committed || p.flight_status === 'confirmed').length;
  const commitRatio = activeCount > 0 ? committedCount / activeCount : 0;

  // Generate celebration message
  const celebration = await generateCelebration(
    admin,
    session,
    participants,
    'destination_locked',
    `${session.destination}`,
  );

  if (commitRatio >= 0.7) {
    // Most already committed — only poll the undecided
    const undecided = participants.filter(
      (p) => p.status === 'active' && !p.committed && p.flight_status !== 'confirmed',
    );

    if (undecided.length === 0) {
      // Everyone's in already
      return celebration + '\n\nEveryone\'s locked in \u2014 let\'s plan the rest. Next up: flights.';
    }

    const names = undecided.map((p) => p.display_name ?? p.phone).join(' and ');
    return celebration + `\n\n${names} \u2014 are you in? Everyone else is locked. Reply YES or NO.`;
  }

  // Standard commit poll
  let msg = celebration + '\n\nWho\'s officially in? Reply YES \u2014 or NO if life gets in the way, no judgment.';

  if (autoCommitted.length > 0) {
    msg += `\n\n${autoCommitted.join(', ')} already ${autoCommitted.length === 1 ? 'has' : 'have'} flights booked \u2014 marked as in.`;
  }

  await enterCelebrationMode(admin, session);

  return msg;
}

// ─── Commit response processing ──────────────────────────────────────────────

/**
 * Process a YES/NO response to the commit poll.
 * Returns a message if the poll resolves, or null if still collecting.
 */
export async function handleCommitResponse(
  admin: SupabaseClient,
  session: TripSession,
  participant: TripSessionParticipant,
  response: 'yes' | 'no',
): Promise<string | null> {
  const committed = response === 'yes';

  // Mark commit response using flights_link_response as commit tracker
  // 'commit_yes' or 'commit_no' — distinct from default null
  await admin
    .from('trip_session_participants')
    .update({
      committed,
      flights_link_response: committed ? 'commit_yes' : 'commit_no',
    })
    .eq('id', participant.id);

  // Check if all active participants have responded
  const { data: allParticipants } = await admin
    .from('trip_session_participants')
    .select('*')
    .eq('trip_session_id', session.id)
    .eq('status', 'active');

  if (!allParticipants) return null;

  // Responded = explicitly said YES/NO or have flights confirmed
  const responded = allParticipants.filter(
    (p) => p.flights_link_response === 'commit_yes' ||
           p.flights_link_response === 'commit_no' ||
           p.flight_status === 'confirmed',
  );

  if (responded.length < allParticipants.length) {
    return null; // Still waiting
  }

  // Everyone has responded — resolve
  return resolveCommitPoll(admin, session, allParticipants);
}

// ─── Commit poll resolution ��──────────────────────────��──────────────────────

async function resolveCommitPoll(
  admin: SupabaseClient,
  session: TripSession,
  participants: TripSessionParticipant[],
): Promise<string> {
  const committed = participants.filter((p) => p.committed === true || p.flight_status === 'confirmed');
  const dropped = participants.filter((p) => p.committed === false && p.flight_status !== 'confirmed');

  // Update committed_participants on session
  await admin
    .from('trip_sessions')
    .update({
      committed_participants: committed.map((p) => ({
        user_id: p.user_id,
        phone: p.phone,
        display_name: p.display_name,
      })),
      updated_at: new Date().toISOString(),
    })
    .eq('id', session.id);

  // ─── All cancel ────────────────────────────────────────────────────────
  if (committed.length === 0) {
    await admin
      .from('trip_sessions')
      .update({ status: 'CANCELLED' })
      .eq('id', session.id);

    return 'No worries \u2014 looks like the timing isn\'t right. I\'ll be here when you\'re ready to try again.';
  }

  // ─── Solo planner ─────────────────────────────────────────────��────────
  if (committed.length === 1) {
    await admin
      .from('trip_sessions')
      .update({ phase: 'AWAITING_PLANNER_DECISION' })
      .eq('id', session.id);

    const name = committed[0].display_name ?? 'mate';
    return `Looks like it's just you left, ${name}. Want to keep planning solo or call it? Reply CONTINUE or CANCEL.`;
  }

  // ─── All in ──────────��─────────────────────────────────────────────────
  if (dropped.length === 0) {
    await admin
      .from('trip_sessions')
      .update({ phase: 'AWAITING_FLIGHTS' })
      .eq('id', session.id);

    return 'Everyone\'s in \u2014 let\'s plan the rest. Next up: flights.\n\nHave you booked flights yet? Reply YES if you\'re sorted, NOT YET if you\'re still working on it, or DRIVING if you\'re not flying.';
  }

  // ─── Some dropped — create new thread ────────────────��─────────────────
  const droppedNames = dropped.map((p) => p.display_name ?? p.phone).join(' and ');

  // Create new session for committed members
  const newSession = await createCommittedThread(admin, session, committed);

  // Mark original session as SPLIT
  await admin
    .from('trip_sessions')
    .update({
      status: 'SPLIT',
      child_session_id: newSession.id,
    })
    .eq('id', session.id);

  return `Got it \u2014 ${droppedNames} ${dropped.length === 1 ? 'is' : 'are'} sitting this one out. Moving planning to a new thread with the crew that's going. See you next time \u{1F44B}`;
}

// ─── New thread creation ───────────��─────────────────────────────────────────

async function createCommittedThread(
  admin: SupabaseClient,
  originalSession: TripSession,
  committedParticipants: TripSessionParticipant[],
): Promise<TripSession> {
  // Derive new thread_id from committed participant phones
  const phones = committedParticipants.map((p) => p.phone);
  const newThreadId = await deriveThreadId(phones);

  // Create new trip_session
  const { data: newSession, error } = await admin
    .from('trip_sessions')
    .insert({
      trip_id: originalSession.trip_id,
      thread_id: newThreadId,
      planner_user_id: originalSession.planner_user_id,
      phase: 'AWAITING_FLIGHTS',
      status: 'ACTIVE',
      destination: originalSession.destination,
      dates: originalSession.dates,
      budget_median: originalSession.budget_median,
      budget_range: (originalSession as Record<string, unknown>).budget_range,
      parent_session_id: originalSession.id,
      committed_participants: committedParticipants.map((p) => ({
        user_id: p.user_id,
        phone: p.phone,
        display_name: p.display_name,
      })),
    })
    .select('*')
    .single();

  if (error) throw new Error(`Failed to create committed thread: ${error.message}`);

  // Copy participants to new session
  for (const p of committedParticipants) {
    await admin.from('trip_session_participants').insert({
      trip_session_id: newSession!.id,
      user_id: p.user_id,
      phone: p.phone,
      display_name: p.display_name,
      status: 'active',
      committed: true,
      flight_status: p.flight_status,
      is_planner: p.is_planner,
      origin_city: p.origin_city,
      origin_airport: p.origin_airport,
    });
  }

  // Queue opening message to new thread
  const dest = originalSession.destination ?? 'the trip';
  const dates = originalSession.dates;
  const dateStr = dates ? `${dates.start}\u2013${dates.end}` : '';

  await admin.from('outbound_message_queue').insert({
    trip_session_id: newSession!.id,
    thread_id: newThreadId,
    priority: 3,
    body: `Hey everyone \u2014 picking up where we left off: ${dest}${dateStr ? ', ' + dateStr : ''}. Next up: flights.\n\nHave you booked flights yet? Reply YES, NOT YET, or DRIVING.`,
  });

  return newSession!;
}

// ─── CONTINUE / CANCEL handling ──────��───────────────────────────────────────

/**
 * Handle CONTINUE or CANCEL when only 1 participant remains.
 */
export async function handlePlannerDecision(
  admin: SupabaseClient,
  session: TripSession,
  decision: 'continue' | 'cancel',
): Promise<string> {
  if (decision === 'cancel') {
    await admin
      .from('trip_sessions')
      .update({ status: 'CANCELLED' })
      .eq('id', session.id);
    return 'Trip cancelled. I\'ll be here when you\'re ready to plan another one.';
  }

  // CONTINUE — advance to flights with solo planner
  await admin
    .from('trip_sessions')
    .update({ phase: 'AWAITING_FLIGHTS' })
    .eq('id', session.id);

  return 'Going solo \u2014 respect. Moving to flights.\n\nHave you booked flights yet? Reply YES, NOT YET, or DRIVING.';
}
