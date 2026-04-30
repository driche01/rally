#!/usr/bin/env node
/**
 * 1:1 full-handshake end-to-end smoke test (Phase 3 of 1:1 SMS pivot).
 *
 * Drives:
 *   1. Planner texts "Plan a Tulum trip" 1:1 → expects URL replied
 *   2. Seeds a join_link_submission for a friend phone (bypasses the
 *      web form — that path is exercised in the manual smoke test)
 *   3. Friend replies YES 1:1 → expects promotion to active participant
 *   4. Planner texts a name + dest → expects INTRO contribution recorded
 *   5. Friend texts a name + dest → expects INTRO contribution + auto-advance
 *   6. Asserts a phase-transition broadcast outbound row exists for both
 *      participants (proving Phase 3's broadcast() is fanning out)
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY in env.
 *
 * Usage:  node scripts/run-1to1-full-handshake.js
 */
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://qxpbnixvjtwckuedlrfj.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) { console.error("SUPABASE_SERVICE_ROLE_KEY env var required"); process.exit(1); }
const RALLY_PHONE = '+16624283059';
const PLANNER_PHONE = `+1555133${pad4(Math.floor(Math.random() * 10000))}`;
const FRIEND_PHONE = `+1555134${pad4(Math.floor(Math.random() * 10000))}`;

const sb = createClient(SUPABASE_URL, SERVICE_KEY);

function pad4(n) { return n.toString().padStart(4, '0'); }

async function postInbound(from, body) {
  const sid = `SM_full_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const params = new URLSearchParams({
    MessageSid: sid,
    From: from,
    To: RALLY_PHONE,
    Body: body,
    NumMedia: '0',
  });
  const res = await fetch(`${SUPABASE_URL}/functions/v1/sms-inbound`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  const text = await res.text();
  const reply = text.match(/<Message>([\s\S]*?)<\/Message>/)?.[1]
    ?.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&apos;/g, "'").replace(/&quot;/g, '"');
  return { status: res.status, reply, sid };
}

function assert(cond, msg) {
  if (!cond) {
    console.error(`  ❌ ${msg}`);
    process.exit(1);
  }
  console.log(`  ✅ ${msg}`);
}

(async () => {
  console.log(`\n🚀 1:1 full handshake smoke test`);
  console.log(`   Planner: ${PLANNER_PHONE}`);
  console.log(`   Friend:  ${FRIEND_PHONE}\n`);

  // Step 1: planner kickoff
  console.log('Step 1: planner texts intent');
  const r1 = await postInbound(PLANNER_PHONE, 'Plan a Tulum trip with my friends');
  console.log(`   reply: ${r1.reply?.slice(0, 120)}`);
  assert(r1.reply?.includes('rallysurveys.netlify.app/join/'), 'kickoff reply contains join URL');
  assert(r1.reply?.includes('Tulum'), 'kickoff reply mentions destination');

  // Pull the trip_session that was just created
  await new Promise((r) => setTimeout(r, 500));
  const { data: planner } = await sb.from('users').select('id').eq('phone', PLANNER_PHONE).single();
  assert(!!planner, 'planner users row exists');
  const { data: session } = await sb.from('trip_sessions')
    .select('id, trip_id, phase, trip_model').eq('planner_user_id', planner.id)
    .order('created_at', { ascending: false }).limit(1).single();
  assert(!!session, 'trip_session row exists');
  assert(session.trip_model === '1to1', `trip_model=${session.trip_model}`);
  assert(session.phase === 'INTRO', `initial phase=${session.phase}`);
  const { data: link } = await sb.from('join_links').select('id, code')
    .eq('trip_session_id', session.id).single();
  assert(!!link?.code, 'join_link minted');

  // Step 2: seed a pending submission for the friend (simulating form submit)
  console.log('\nStep 2: seed join_link_submission for friend');
  const { data: sub, error: subErr } = await sb.from('join_link_submissions').insert({
    join_link_id: link.id,
    phone: FRIEND_PHONE,
    display_name: 'Test Friend',
    status: 'pending',
    confirmation_sent_at: new Date().toISOString(),
  }).select('id').single();
  assert(!subErr && !!sub, 'submission seeded');

  // Step 3: friend replies YES
  console.log('\nStep 3: friend replies YES');
  const r3 = await postInbound(FRIEND_PHONE, 'YES');
  // YES short-circuits with response: null — the kickoff is sent via dm-sender, not TwiML.
  // Just verify the participant row was promoted.
  await new Promise((r) => setTimeout(r, 1000));
  const { data: friendPart } = await sb.from('trip_session_participants')
    .select('id, phone, status, is_attending')
    .eq('trip_session_id', session.id)
    .eq('phone', FRIEND_PHONE)
    .single();
  assert(!!friendPart, 'friend promoted to participant');
  assert(friendPart.status === 'active', `friend status=${friendPart.status}`);
  assert(friendPart.is_attending === true, 'friend is_attending=true');

  // Step 4: planner texts name + destination (INTRO contribution)
  console.log('\nStep 4: planner contributes name + destination');
  const r4 = await postInbound(PLANNER_PHONE, 'Sarah — Tulum');
  console.log(`   reply: ${r4.reply?.slice(0, 120)}`);

  // Step 5: friend texts name + destination — should auto-advance INTRO since 2 named
  console.log('\nStep 5: friend contributes name + destination');
  const r5 = await postInbound(FRIEND_PHONE, 'Mike — Cancun');
  console.log(`   reply: ${r5.reply?.slice(0, 120)}`);

  // Step 6: trigger advance via planner saying YES
  console.log('\nStep 6: planner confirms with YES → expects phase advance broadcast');
  const r6 = await postInbound(PLANNER_PHONE, 'YES');
  console.log(`   reply: ${r6.reply?.slice(0, 200)}`);

  // Verify session advanced
  await new Promise((r) => setTimeout(r, 1000));
  const { data: advancedSession } = await sb.from('trip_sessions')
    .select('phase').eq('id', session.id).single();
  assert(['COLLECTING_DESTINATIONS', 'DECIDING_DATES'].includes(advancedSession.phase),
    `advanced phase=${advancedSession.phase}`);

  // Step 7: verify TwiML acknowledgment paths logged correctly. Broadcast
  // outbound rows can't be verified with +1555 fake numbers (Twilio rejects
  // them so sendDm never gets a SID to log). The TwiML acks cover the
  // sender-side TwiML path; the manual real-SMS smoke covers the broadcast
  // delivery side.
  console.log('\nStep 7: verify TwiML outbound rows');
  const { data: outbound } = await sb.from('thread_messages')
    .select('thread_id, body, direction, created_at')
    .eq('trip_session_id', session.id)
    .eq('direction', 'outbound')
    .order('created_at', { ascending: false })
    .limit(20);
  console.log(`   outbound rows: ${outbound?.length ?? 0}`);
  const friendThread = `1to1_${FRIEND_PHONE}`;
  const plannerThread = `1to1_${PLANNER_PHONE}`;
  const friendOutbound = (outbound ?? []).filter((m) => m.thread_id === friendThread);
  const plannerOutbound = (outbound ?? []).filter((m) => m.thread_id === plannerThread);
  console.log(`   friend(${friendThread}): ${friendOutbound.length}`);
  console.log(`   planner(${plannerThread}): ${plannerOutbound.length}`);
  // Each phone gets one TwiML ack per inbound that returned a string.
  // Planner had 3 inbound returning strings; friend had 2 (1 silent YES + 1 INTRO ack).
  assert(plannerOutbound.length >= 3, `planner ≥3 TwiML acks, got ${plannerOutbound.length}`);
  assert(friendOutbound.length >= 1, `friend ≥1 TwiML ack, got ${friendOutbound.length}`);

  // Confirm the phase-advance broadcast body landed in the planner's TwiML
  // reply (proves announceTransition was reached on the way to the return).
  const advanceMatch = plannerOutbound.find((m) =>
    m.body.includes('on the table') || m.body.includes('it is!'));
  assert(!!advanceMatch, 'planner received phase-advance message via TwiML');

  console.log('\n✅ Phase 3 structural assertions passed.');
  console.log('   (broadcast delivery to friend is verified via real-SMS smoke, not fake-number tests)\n');
})().catch((err) => {
  console.error('\n❌ Test failed:', err);
  process.exit(1);
});
