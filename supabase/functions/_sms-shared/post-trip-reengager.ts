/**
 * Component 13: PostTripReEngager
 *
 * Fires 6–8 weeks after trip end date.
 * Sends one re-engagement message per trip, respects STOP opt-outs.
 * Called by NudgeScheduler (not a standalone cron).
 *
 * If any participant replies YES, creates a new session in the same thread.
 */
import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

/**
 * Find sessions eligible for re-engagement and send messages.
 * Returns count of messages sent.
 */
export async function runReEngagement(admin: SupabaseClient): Promise<number> {
  const now = new Date();
  const fortyTwoDaysAgo = new Date(now.getTime() - 42 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const fiftySixDaysAgo = new Date(now.getTime() - 56 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  // Find sessions where trip ended 6-8 weeks ago
  const { data: sessions } = await admin
    .from('trip_sessions')
    .select('id, thread_id, destination, dates, re_engagement_sent')
    .in('status', ['FIRST_BOOKING_REACHED', 'COMPLETE'])
    .eq('re_engagement_sent', false);

  if (!sessions || sessions.length === 0) return 0;

  let sent = 0;

  for (const session of sessions) {
    const dates = session.dates as { end?: string } | null;
    if (!dates?.end) continue;

    const endDate = dates.end;
    // Check if end date is between 42 and 56 days ago
    if (endDate > fortyTwoDaysAgo || endDate < fiftySixDaysAgo) continue;

    const weeksAgo = Math.round(
      (now.getTime() - new Date(endDate).getTime()) / (7 * 24 * 60 * 60 * 1000),
    );
    const dest = session.destination ?? 'that trip';

    const msg =
      `Your ${dest} trip was ${weeksAgo} weeks ago \u2014 already time to plan the next one? ` +
      `Reply YES and I'll get the group going.`;

    // Store outbound message
    await admin.from('thread_messages').insert({
      thread_id: session.thread_id,
      trip_session_id: session.id,
      direction: 'outbound',
      sender_role: 'rally',
      body: msg,
    });

    // Queue for sending
    await admin.from('outbound_message_queue').insert({
      trip_session_id: session.id,
      thread_id: session.thread_id,
      priority: 4,
      body: msg,
    });

    // Mark as sent and update status
    await admin
      .from('trip_sessions')
      .update({
        re_engagement_sent: true,
        re_engagement_sent_at: now.toISOString(),
        status: 'RE_ENGAGEMENT_PENDING',
      })
      .eq('id', session.id);

    sent++;
  }

  return sent;
}

/**
 * Handle a YES reply to a re-engagement message.
 * Creates a new session with all original participants.
 */
export async function handleReEngagementYes(
  admin: SupabaseClient,
  originalSessionId: string,
  responderUserId: string,
): Promise<{ newSessionId: string; message: string } | null> {
  const { data: original } = await admin
    .from('trip_sessions')
    .select('*')
    .eq('id', originalSessionId)
    .single();

  // #91 — First YES changes status to COMPLETE; subsequent YES messages won't
  // match RE_ENGAGEMENT_PENDING, so they fall through to the new active session.
  if (!original || original.status !== 'RE_ENGAGEMENT_PENDING') return null;

  // Get original participants
  const { data: participants } = await admin
    .from('trip_session_participants')
    .select('user_id, phone, display_name, is_planner')
    .eq('trip_session_id', originalSessionId)
    .neq('status', 'opted_out');

  if (!participants || participants.length === 0) return null;

  // Create new session — responder becomes planner
  const { data: newSession, error } = await admin
    .from('trip_sessions')
    .insert({
      trip_id: original.trip_id,
      thread_id: original.thread_id,
      planner_user_id: responderUserId,
      phase: 'INTRO',
      status: 'ACTIVE',
      thread_name: original.thread_name,
    })
    .select('id')
    .single();

  if (error) {
    console.error('[re-engager] Failed to create new session:', error);
    return null;
  }

  // Add all original participants (all start uncommitted)
  const originalUserIds = new Set(participants.map((p) => p.user_id));
  for (const p of participants) {
    await admin.from('trip_session_participants').insert({
      trip_session_id: newSession!.id,
      user_id: p.user_id,
      phone: p.phone,
      display_name: p.display_name,
      status: 'active',
      committed: false,
      is_planner: p.user_id === responderUserId,
    });
  }

  // #89 — If responder wasn't in the original participants, add them too
  if (!originalUserIds.has(responderUserId)) {
    const { data: responderUser } = await admin
      .from('users')
      .select('phone, display_name')
      .eq('id', responderUserId)
      .maybeSingle();

    if (responderUser) {
      await admin.from('trip_session_participants').insert({
        trip_session_id: newSession!.id,
        user_id: responderUserId,
        phone: responderUser.phone,
        display_name: responderUser.display_name,
        status: 'active',
        committed: false,
        is_planner: true,
      });
    }
  }

  // Mark original session as COMPLETE
  await admin
    .from('trip_sessions')
    .update({ status: 'COMPLETE' })
    .eq('id', originalSessionId);

  return {
    newSessionId: newSession!.id,
    message:
      "Let's go again! \u{1F30A} Same crew, new trip. " +
      'Drop your destination ideas and let\'s get planning.',
  };
}
