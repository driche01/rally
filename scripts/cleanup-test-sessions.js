#!/usr/bin/env node
/**
 * Clean up test sessions/participants/messages from the database.
 * Removes anything with phone numbers matching test prefixes.
 */
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '***SCRUBBED-SUPABASE-SERVICE-ROLE-KEY***';
const BASE = 'https://qxpbnixvjtwckuedlrfj.supabase.co/rest/v1';
const HEADERS = {
  'apikey': SERVICE_KEY,
  'Authorization': `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
  'Prefer': 'return=minimal',
};

async function query(table, params = '') {
  const res = await fetch(`${BASE}/${table}?${params}`, { headers: { ...HEADERS, 'Prefer': 'return=representation' } });
  return res.json();
}

async function del(table, params) {
  const res = await fetch(`${BASE}/${table}?${params}`, { method: 'DELETE', headers: HEADERS });
  return res.status;
}

async function run() {
  // Find test participants (phone starts with +1555)
  const participants = await query('trip_session_participants', 'phone=like.%2B1555*');
  const sessionIds = [...new Set(participants.map(p => p.trip_session_id))];
  console.log(`Found ${participants.length} test participants in ${sessionIds.length} sessions`);

  // Delete thread messages for test sessions
  for (const sid of sessionIds) {
    const s1 = await del('thread_messages', `trip_session_id=eq.${sid}`);
    console.log(`  Deleted thread_messages for session ${sid.slice(0,8)}... (${s1})`);
  }

  // Delete participants
  for (const sid of sessionIds) {
    const s2 = await del('trip_session_participants', `trip_session_id=eq.${sid}`);
    console.log(`  Deleted participants for session ${sid.slice(0,8)}... (${s2})`);
  }

  // Delete sessions
  for (const sid of sessionIds) {
    const s3 = await del('trip_sessions', `id=eq.${sid}`);
    console.log(`  Deleted session ${sid.slice(0,8)}... (${s3})`);
  }

  // Delete test users
  const users = await query('users', 'phone=like.%2B1555*');
  console.log(`Found ${users.length} test users`);
  for (const u of users) {
    await del('users', `id=eq.${u.id}`);
  }

  // Also clean up thread messages with test sender phones  
  const s4 = await del('thread_messages', 'sender_phone=like.%2B1555*');
  console.log(`Cleaned up thread_messages by sender_phone (${s4})`);

  // Clean up 1:1 thread messages
  const s5 = await del('thread_messages', 'thread_id=like.1to1_%2B1555*');
  console.log(`Cleaned up 1:1 thread_messages (${s5})`);

  console.log('\nDone! Database is clean for fresh test run.');
}

run().catch(console.error);
