#!/usr/bin/env node
/**
 * Launch a test trip you can drive end-to-end.
 *
 * Creates a real trip in production with a real trip_session and N
 * participant rows. Optionally pokes the scheduler so the initial SMS
 * fires within seconds instead of waiting for the next 15-min cron tick.
 *
 * The trip name is prefixed with `__e2e__` so it's easy to distinguish
 * from real trips. Use scripts/cleanup-test-trip.js to remove it.
 *
 * Usage:
 *   node scripts/launch-test-trip.js \
 *     --planner-phone +15551112222 \
 *     --participant +15553334444 [--participant +15555556666 ...] \
 *     [--book-by-days 5] \
 *     [--destination "Cancun"] \
 *     [--name "My Test Trip"] \
 *     [--no-poke]
 *
 * Required env (or use the hardcoded service-role default):
 *   SUPABASE_SERVICE_ROLE_KEY
 */
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://qxpbnixvjtwckuedlrfj.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY env var required'); process.exit(1);
}
const SURVEY_BASE = 'https://rallysurveys.netlify.app';

const sb = createClient(SUPABASE_URL, SERVICE_KEY);
const fs = require('fs');
const path = require('path');

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {
    plannerPhone: null,
    participants: [],
    bookByDays: 5,
    destination: 'Cancun',
    name: null,
    poke: true,
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--planner-phone')  out.plannerPhone = args[++i];
    else if (a === '--participant') out.participants.push(args[++i]);
    else if (a === '--book-by-days') out.bookByDays = parseInt(args[++i], 10);
    else if (a === '--destination') out.destination = args[++i];
    else if (a === '--name')       out.name = args[++i];
    else if (a === '--no-poke')    out.poke = false;
    else if (a === '--help' || a === '-h') {
      console.log(`Usage:\n  node scripts/launch-test-trip.js --planner-phone +15551112222 \\\n    --participant +15553334444 [--participant ...] \\\n    [--book-by-days 5] [--destination "Cancun"] [--name "My Trip"] [--no-poke]`);
      process.exit(0);
    }
  }
  return out;
}

function normPhone(p) {
  if (!p) return null;
  const digits = p.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return digits;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

async function findOrCreatePlanner(phone) {
  // Look up the existing profile by phone (or fall back to the first profile).
  let { data: profile } = await sb.from('profiles').select('id, name, phone').eq('phone', phone).maybeSingle();
  if (profile) return profile;

  // Phone-only test planners need a profiles row that the trips.created_by FK accepts.
  // Reuse the most-recent profile so we don't pollute auth.users with fixtures.
  const { data: any } = await sb.from('profiles').select('id, name, phone').limit(1).maybeSingle();
  if (!any) throw new Error('No profiles in DB — create at least one user account first.');
  console.log(`  ⚠ Using fallback profile ${any.name ?? any.id} (no exact match for ${phone})`);
  return any;
}

async function ensureUserByPhone(phone, displayName) {
  let { data } = await sb.from('users').select('id').eq('phone', phone).maybeSingle();
  if (data) return data.id;
  const { data: created, error } = await sb
    .from('users')
    .insert({ phone, display_name: displayName, rally_account: false, opted_out: false })
    .select('id').single();
  if (error) throw new Error(`users insert failed for ${phone}: ${error.message}`);
  return created.id;
}

async function main() {
  const args = parseArgs();
  if (!args.plannerPhone || args.participants.length === 0) {
    console.error('❌ Need --planner-phone and at least one --participant');
    console.error('   See: node scripts/launch-test-trip.js --help');
    process.exit(2);
  }

  const plannerPhone = normPhone(args.plannerPhone);
  const participantPhones = args.participants.map(normPhone).filter(Boolean);
  if (!plannerPhone || participantPhones.length !== args.participants.length) {
    console.error('❌ One or more phone numbers failed to normalize. Use E.164 like +15551112222.');
    process.exit(2);
  }

  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const tripName = args.name ?? `__e2e__ ${stamp}`;
  const bookBy = new Date(Date.now() + args.bookByDays * 86400000).toISOString().slice(0, 10);

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  Launching test trip: "${tripName}"`);
  console.log(`${'─'.repeat(60)}`);
  console.log(`  Destination:  ${args.destination}`);
  console.log(`  Book-by:      ${bookBy} (${args.bookByDays} days out)`);
  console.log(`  Planner:      ${plannerPhone}`);
  console.log(`  Participants: ${participantPhones.length}`);
  participantPhones.forEach((p, i) => console.log(`                ${i + 1}. ${p}`));
  console.log('');

  // ─── 1. Resolve planner profile (need a real user for trips.created_by FK) ─
  const profile = await findOrCreatePlanner(plannerPhone);
  console.log(`  ✓ Planner profile resolved: ${profile.name ?? profile.id}`);

  // ─── 2. Insert trip ────────────────────────────────────────────────────────
  const shareToken = `e2e_${Math.random().toString(36).slice(2, 10)}`;
  const { data: trip, error: tripErr } = await sb.from('trips').insert({
    created_by: profile.id,
    name: tripName,
    group_size_bucket: '5-8',
    share_token: shareToken,
    status: 'active',
    book_by_date: bookBy,
    destination: args.destination,
  }).select().single();
  if (tripErr) throw new Error(`trip insert failed: ${tripErr.message}`);
  console.log(`  ✓ Trip created: ${trip.id}`);
  console.log(`    responses_due_date auto-derived: ${trip.responses_due_date}`);

  // ─── 3. Resolve planner users.id + create trip_session ─────────────────────
  const plannerUserId = await ensureUserByPhone(plannerPhone, profile.name ?? 'Planner');
  const { data: session, error: sesErr } = await sb.from('trip_sessions').insert({
    trip_id: trip.id,
    planner_user_id: plannerUserId,
    phase: 'INTRO',
    status: 'ACTIVE',
    last_message_at: new Date().toISOString(),
    thread_id: `e2e_${trip.id}`,
  }).select().single();
  if (sesErr) throw new Error(`session insert failed: ${sesErr.message}`);
  console.log(`  ✓ Trip session created: ${session.id}`);

  // ─── 4. Insert planner as a participant (so dashboard shows them) ──────────
  await sb.from('trip_session_participants').insert({
    trip_session_id: session.id,
    user_id: plannerUserId,
    phone: plannerPhone,
    display_name: profile.name ?? 'Planner',
    status: 'active',
    is_attending: true,
    is_planner: true,
  });
  console.log(`  ✓ Planner added as participant`);

  // ─── 5. Insert each participant ────────────────────────────────────────────
  for (let i = 0; i < participantPhones.length; i++) {
    const phone = participantPhones[i];
    const userId = await ensureUserByPhone(phone, `Test ${i + 1}`);
    await sb.from('trip_session_participants').insert({
      trip_session_id: session.id,
      user_id: userId,
      phone,
      display_name: `Test ${i + 1}`,
      status: 'active',
      is_attending: true,
      is_planner: false,
    });
    console.log(`  ✓ Participant ${i + 1} added: ${phone}`);
  }

  // ─── 6. Optionally poke the scheduler so initial SMS fires now ─────────────
  if (args.poke) {
    console.log('\n  ⏱  Poking scheduler...');
    const res = await fetch(`${SUPABASE_URL}/functions/v1/sms-nudge-scheduler`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SERVICE_KEY}`,
      },
      body: '{}',
    });
    const json = await res.json();
    console.log(`  ✓ Scheduler responded: seed=${JSON.stringify(json.seed)} fire=${JSON.stringify(json.fire)}`);
    if ((json.fire?.sent ?? 0) > 0) {
      console.log(`  📨 ${json.fire.sent} SMS sent. Check the participants' phones now.`);
    } else if ((json.seed?.inserted ?? 0) > 0) {
      console.log(`  📅 ${json.seed.inserted} cadence rows seeded but FIRE pass found nothing due. Check your launch_at vs scheduled_for.`);
    }
  } else {
    console.log('\n  ⏭  --no-poke set; cadence will fire on the next 15-min cron tick.');
  }

  // ─── 7. Save state for follow-up scripts ───────────────────────────────────
  const stateFile = path.join(__dirname, '..', '.test-trip.json');
  fs.writeFileSync(stateFile, JSON.stringify({
    trip_id: trip.id,
    trip_session_id: session.id,
    share_token: shareToken,
    planner_phone: plannerPhone,
    participant_phones: participantPhones,
    created_at: new Date().toISOString(),
  }, null, 2));

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  TRIP READY`);
  console.log(`${'═'.repeat(60)}`);
  console.log(`  Trip ID:        ${trip.id}`);
  console.log(`  Survey URL:     ${SURVEY_BASE}/respond/${shareToken}`);
  console.log(`  Results URL:    ${SURVEY_BASE}/results/${shareToken}`);
  console.log(`  Summary URL:    ${SURVEY_BASE}/summary/${shareToken}`);
  console.log(`  Status URL:     ${SURVEY_BASE}/status/${shareToken}`);
  console.log(`  In the app:     /(app)/trips/${trip.id}/members  (Group Dashboard)`);
  console.log(`\n  Trip state saved to .test-trip.json`);
  console.log(`  Watch live:     node scripts/watch-trip.js`);
  console.log(`  Poke again:     node scripts/poke-scheduler.js`);
  console.log(`  Clean up:       node scripts/cleanup-test-trip.js\n`);
}

main().catch((err) => {
  console.error('\n❌ Failed:', err.message);
  process.exit(1);
});
