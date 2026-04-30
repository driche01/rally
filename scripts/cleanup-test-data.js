#!/usr/bin/env node
/**
 * Cleans up all SMS agent test data from Supabase.
 * Run after test scripts to reset state.
 */
const { createClient } = require('@supabase/supabase-js');

if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY env var required'); process.exit(1);
}

const admin = createClient(
  process.env.SUPABASE_URL || 'https://qxpbnixvjtwckuedlrfj.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

async function cleanup() {
  console.log('Cleaning up test data...');

  await admin.from('split_requests').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await admin.from('propose_requests').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await admin.from('booking_signals').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await admin.from('trip_access_tokens').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await admin.from('thread_messages').delete().like('message_sid', 'SM_%');
  await admin.from('thread_messages').delete().is('message_sid', null);
  await admin.from('outbound_message_queue').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await admin.from('scheduled_actions').delete().neq('id', '00000000-0000-0000-0000-000000000000');

  // Delete poll responses for SMS polls
  const { data: smsPolls } = await admin.from('polls').select('id').not('trip_session_id', 'is', null);
  for (const p of smsPolls || []) {
    await admin.from('poll_responses').delete().eq('poll_id', p.id);
    await admin.from('poll_options').delete().eq('poll_id', p.id);
  }
  await admin.from('polls').delete().not('trip_session_id', 'is', null);

  const { data: sessions } = await admin.from('trip_sessions').select('id, trip_id');
  for (const s of sessions || []) {
    await admin.from('trip_session_participants').delete().eq('trip_session_id', s.id);
    await admin.from('trip_session_events').delete().eq('trip_session_id', s.id);
    await admin.from('respondents').delete().eq('trip_id', s.trip_id).not('user_id', 'is', null);
  }

  // Delete child sessions first (parent FK)
  await admin.from('trip_sessions').delete().not('parent_session_id', 'is', null);
  await admin.from('trip_sessions').delete().neq('id', '00000000-0000-0000-0000-000000000000');

  await admin.from('users').delete().like('phone', '+1555%');

  console.log('Done — all SMS test data cleaned.');
}

cleanup().catch((err) => {
  console.error('Cleanup failed:', err);
  process.exit(1);
});
