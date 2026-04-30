#!/usr/bin/env node
/**
 * Wipe the active e2e test trip + all related rows.
 *
 * Reads .test-trip.json (written by launch-test-trip.js) or takes
 * --trip-id as an arg. Cascades through trip_session_participants,
 * nudge_sends, poll_recommendations, polls, respondents, thread_messages
 * via the FK chain. Test users (created with `__e2e__` markers) and
 * test profiles are LEFT in place — they're shared with real data.
 *
 * Pass --all to delete every trip whose name starts with `__e2e__`
 * (useful if you've accumulated a few stale fixtures).
 *
 *   node scripts/cleanup-test-trip.js
 *   node scripts/cleanup-test-trip.js --trip-id <uuid>
 *   node scripts/cleanup-test-trip.js --all
 */
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const SUPABASE_URL = 'https://qxpbnixvjtwckuedlrfj.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY env var required'); process.exit(1);
}
const sb = createClient(SUPABASE_URL, SERVICE_KEY);

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { tripId: null, all: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--trip-id') out.tripId = args[++i];
    else if (args[i] === '--all') out.all = true;
  }
  return out;
}

async function deleteTrip(id) {
  // Children cascade through trip_id / trip_session_id FKs.
  // Migration 081 added the missing ON DELETE CASCADE on trip_sessions.trip_id
  // and on every dependent table (trip_session_events, thread_messages,
  // scheduled_actions, outbound_message_queue, trip_access_tokens,
  // split_requests, propose_requests, booking_signals). polls and respondents
  // already cascade via trip_id (migration 001).
  const { error, data } = await sb.from('trips').delete().eq('id', id).select('id, name');
  if (error) throw error;
  return data?.[0] ?? null;
}

async function main() {
  const args = parseArgs();

  if (args.all) {
    const { data: trips } = await sb.from('trips').select('id, name').like('name', '__e2e__%');
    if (!trips || trips.length === 0) {
      console.log('No trips matching __e2e__% found.');
      return;
    }
    console.log(`Deleting ${trips.length} fixture trip(s):`);
    for (const t of trips) {
      try {
        await deleteTrip(t.id);
        console.log(`  ✓ ${t.name} (${t.id})`);
      } catch (err) {
        console.error(`  ✗ ${t.name}: ${err.message}`);
      }
    }
    const stateFile = path.join(__dirname, '..', '.test-trip.json');
    if (fs.existsSync(stateFile)) fs.unlinkSync(stateFile);
    return;
  }

  let tripId = args.tripId;
  const stateFile = path.join(__dirname, '..', '.test-trip.json');
  if (!tripId) {
    if (!fs.existsSync(stateFile)) {
      console.error('No --trip-id and no .test-trip.json. Use --all to wipe every __e2e__ trip.');
      process.exit(2);
    }
    tripId = JSON.parse(fs.readFileSync(stateFile, 'utf-8')).trip_id;
  }

  const removed = await deleteTrip(tripId);
  if (!removed) {
    console.log(`Trip ${tripId} was not found (already deleted?).`);
  } else {
    console.log(`✓ Deleted: ${removed.name} (${removed.id})`);
  }
  if (fs.existsSync(stateFile)) fs.unlinkSync(stateFile);
}

main().catch((err) => {
  console.error('❌ Failed:', err.message);
  process.exit(1);
});
