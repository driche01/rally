#!/usr/bin/env node
/**
 * seed-join-submission.js
 *
 * Phase 1 verification helper. Creates a trip_session + join_link +
 * pending join_link_submission so the join_link_yes simulator fixture
 * has something to confirm against.
 *
 * Usage:
 *   node scripts/seed-join-submission.js \
 *       --phone +15551310099 \
 *       --name Sarah \
 *       [--planner-phone +15551310001] \
 *       [--destination "Yosemite"] \
 *       [--base-url <supabase fn url>]
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY in env.
 *
 * Idempotent: if a session for the planner already exists in ACTIVE state
 * it reuses it. Inserts a fresh join_link + submission every run so the
 * inbound YES has a single unambiguous match.
 */
const { createClient } = require('@supabase/supabase-js');

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < args.length; i += 2) {
    const k = args[i].replace(/^--/, '');
    const v = args[i + 1];
    out[k] = v;
  }
  return out;
}

async function main() {
  const args = parseArgs();
  const SUPABASE_URL =
    args['base-url'] || process.env.SUPABASE_URL || 'https://qxpbnixvjtwckuedlrfj.supabase.co';
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SERVICE_KEY) {
    console.error('SUPABASE_SERVICE_ROLE_KEY not set');
    process.exit(1);
  }
  const phone = args.phone;
  const name = args.name || 'Test User';
  const plannerPhone = args['planner-phone'] || '+15551310001';
  const destination = args.destination || 'Yosemite';
  if (!phone) {
    console.error('--phone required');
    process.exit(1);
  }

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  // 1. find or create planner user
  let { data: planner } = await sb
    .from('users')
    .select('id, phone, display_name')
    .eq('phone', plannerPhone)
    .maybeSingle();
  if (!planner) {
    const ins = await sb
      .from('users')
      .insert({ phone: plannerPhone, display_name: 'Test Planner', rally_account: false })
      .select('id, phone, display_name')
      .single();
    planner = ins.data;
  }

  // 2. find or create active trip_session for planner
  let { data: session } = await sb
    .from('trip_sessions')
    .select('id, planner_user_id, destination, status')
    .eq('planner_user_id', planner.id)
    .eq('status', 'ACTIVE')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!session) {
    const ins = await sb
      .from('trip_sessions')
      .insert({
        planner_user_id: planner.id,
        thread_id: null,
        phase: 'INTRO',
        status: 'ACTIVE',
        destination,
        trip_model: '1to1',
      })
      .select('id, planner_user_id, destination, status')
      .single();
    session = ins.data;
    // ensure planner is a participant
    await sb.from('trip_session_participants').insert({
      trip_session_id: session.id,
      user_id: planner.id,
      phone: plannerPhone,
      display_name: planner.display_name,
      status: 'active',
      is_planner: true,
      is_attending: true,
    });
  }

  // 3. create a join_link
  const code = generateCode();
  const { data: link, error: linkErr } = await sb
    .from('join_links')
    .insert({
      trip_session_id: session.id,
      code,
      created_by_user_id: planner.id,
    })
    .select('id, code')
    .single();
  if (linkErr) throw linkErr;

  // 4. create a pending join_link_submission for the joiner phone
  const { data: submission, error: subErr } = await sb
    .from('join_link_submissions')
    .insert({
      join_link_id: link.id,
      phone,
      display_name: name,
      status: 'pending',
      confirmation_sent_at: new Date().toISOString(),
    })
    .select('id, phone, status')
    .single();
  if (subErr) throw subErr;

  console.log(JSON.stringify({
    ok: true,
    trip_session_id: session.id,
    planner_phone: plannerPhone,
    join_link_code: code,
    submission_id: submission.id,
    joiner_phone: phone,
    joiner_name: name,
    next: `Run: node scripts/simulate.js --script scripts/fixtures/join_link_yes.json`,
  }, null, 2));
}

function generateCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 8; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
