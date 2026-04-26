#!/usr/bin/env node
/**
 * Pivot verification — exhaustive end-to-end smoke test for the post-pivot
 * surface. Runs against production. Does NOT require real-SMS delivery
 * (Twilio rejects fake +1555 numbers, which is fine — we exercise the
 * server-side logic and DB invariants).
 *
 * Coverage:
 *   1. /join/[code] preview RPC (get_join_link_preview)
 *   2. sms-join-submit edge function (form submission path)
 *   3. confirm_join_submission RPC (YES handshake DB transition)
 *   4. SMS kill-switch — every inbound that's no longer handled returns
 *      the redirect message; STOP/REJOIN flip opted_out; APP keyword still
 *      returns the install link
 *   5. /status/[token] data layer (getTripByShareToken)
 *   6. Account-screen claim check (check_claim_available)
 *   7. Phase 4 dashboard data layer (RLS — but we use service-role here,
 *      so we just confirm the rows are reachable)
 *   8. Phase 4.5 activity feed
 *
 * Usage: node scripts/run-pivot-verification.js
 *        SUPABASE_SERVICE_ROLE_KEY must be set or hard-coded default works.
 */
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://qxpbnixvjtwckuedlrfj.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ||
  '***SCRUBBED-SUPABASE-SERVICE-ROLE-KEY***';
const RALLY_PHONE = '+16624283059';

const sb = createClient(SUPABASE_URL, SERVICE_KEY);

let passed = 0;
let failed = 0;
function ok(msg)  { console.log(`  ✅ ${msg}`); passed += 1; }
function bad(msg) { console.error(`  ❌ ${msg}`); failed += 1; }
function section(name) { console.log(`\n${'═'.repeat(60)}\n  ${name}\n${'═'.repeat(60)}`); }

async function postSms(from, body) {
  const sid = `SM_verify_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
  const params = new URLSearchParams({
    MessageSid: sid, From: from, To: RALLY_PHONE, Body: body, NumMedia: '0',
  });
  const res = await fetch(`${SUPABASE_URL}/functions/v1/sms-inbound`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  const text = await res.text();
  return text.match(/<Message>([\s\S]*?)<\/Message>/)?.[1]
    ?.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&apos;/g, "'") ?? null;
}

(async () => {
  // ─── Setup: find or create a test trip with planner + session + join_link ──
  section('SETUP');
  const SUFFIX = String(Date.now()).slice(-6);
  const PLANNER_PHONE = `+15551${SUFFIX.slice(0,4)}1`;
  const FRIEND_PHONE  = `+15551${SUFFIX.slice(0,4)}2`;

  // Planner users row
  const { data: planner } = await sb.from('users').insert({
    phone: PLANNER_PHONE, display_name: 'Verify Planner', rally_account: false,
  }).select('id').single();
  ok(`created planner users row ${planner.id.slice(0,8)}`);

  // Trip
  const { data: trip } = await sb.from('trips').insert({
    name: 'Pivot Verification Trip',
    destination: 'Costa Rica',
    created_by: null,
    group_size_bucket: '5-8',
    status: 'active',
  }).select('id, share_token').single();
  ok(`created trip ${trip.id.slice(0,8)} (share_token ${trip.share_token.slice(0,12)})`);

  // Trip session
  const { data: session } = await sb.from('trip_sessions').insert({
    trip_id: trip.id, planner_user_id: planner.id, phase: 'INTRO',
    status: 'ACTIVE', destination: 'Costa Rica', trip_model: '1to1',
  }).select('id').single();
  ok(`created trip_session ${session.id.slice(0,8)}`);

  // Add planner as participant
  await sb.from('trip_session_participants').insert({
    trip_session_id: session.id, user_id: planner.id, phone: PLANNER_PHONE,
    display_name: 'Verify Planner', status: 'active', is_planner: true, is_attending: true,
  });

  // Mint a join_link
  const code = Array.from({length: 8}, () =>
    'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random()*32)]).join('');
  const { data: link } = await sb.from('join_links').insert({
    trip_session_id: session.id, code, created_by_user_id: planner.id,
  }).select('id').single();
  ok(`minted join_link code ${code}`);

  // ─── 1. /join/[code] preview RPC ──────────────────────────────────────────
  section('1. /join/[code] PREVIEW RPC');
  {
    const { data: preview, error } = await sb.rpc('get_join_link_preview', { p_code: code });
    if (error) { bad(`RPC error: ${error.message}`); }
    else if (!preview?.ok) bad(`RPC returned ok=false: ${preview?.reason}`);
    else {
      ok('preview returns ok=true');
      preview.destination === 'Costa Rica' ? ok('destination correct') : bad(`destination=${preview.destination}`);
      preview.planner_name === 'Verify Planner' ? ok('planner_name correct') : bad(`planner_name=${preview.planner_name}`);
      preview.member_count === 1 ? ok('member_count=1 (just planner)') : bad(`member_count=${preview.member_count}`);
    }
  }

  // ─── 2. sms-join-submit edge function ─────────────────────────────────────
  section('2. sms-join-submit EDGE FUNCTION');
  {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/sms-join-submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code, phone: FRIEND_PHONE, display_name: 'Verify Friend', email: null,
      }),
    });
    const json = await res.json();
    res.status === 200 ? ok('endpoint returned 200') : bad(`status=${res.status}`);
    // Twilio will fail on +1555 fake → ok=false reason=sms_send_failed
    json.reason === 'sms_send_failed' ? ok('expected sms_send_failed for fake +1555 (path executed)') : bad(`unexpected reason=${json.reason}`);

    // Confirm a pending submission was created in DB
    const { data: sub } = await sb.from('join_link_submissions')
      .select('phone, display_name, status, join_link_id')
      .eq('phone', FRIEND_PHONE).order('created_at',{ascending:false}).limit(1).single();
    sub?.status === 'pending' ? ok('submission row created with status=pending') : bad(`sub status=${sub?.status}`);
    sub?.join_link_id === link.id ? ok('submission tied to correct join_link') : bad('join_link mismatch');
  }

  // ─── 3. confirm_join_submission RPC (YES handshake DB transition) ─────────
  section('3. confirm_join_submission RPC');
  {
    const { data: result } = await sb.rpc('confirm_join_submission', {
      p_phone: FRIEND_PHONE, p_decision: 'confirmed',
    });
    result?.ok && result.reason === 'confirmed' ? ok('YES → confirmed') : bad(`unexpected ${JSON.stringify(result)}`);
    result?.trip_session_id === session.id ? ok('returns correct trip_session_id') : bad('wrong session');

    // Verify participant promoted
    const { data: friendPart } = await sb.from('trip_session_participants')
      .select('phone, status, is_attending')
      .eq('trip_session_id', session.id).eq('phone', FRIEND_PHONE).single();
    friendPart?.status === 'active' ? ok('friend promoted to active') : bad(`status=${friendPart?.status}`);
    friendPart?.is_attending === true ? ok('friend is_attending=true') : bad('is_attending wrong');
  }

  // ─── 4. SMS kill-switch ───────────────────────────────────────────────────
  section('4. SMS KILL-SWITCH');
  const TEST_PHONE = `+15551${SUFFIX.slice(0,4)}3`;

  let r = await postSms(TEST_PHONE, 'Plan a Yosemite trip with my friends');
  r?.includes("I'm Rally") && r.includes('rallysurveys.netlify.app')
    ? ok('planning intent → redirect (NOT auto-session)') : bad(`unexpected: ${r?.slice(0,80)}`);

  r = await postSms(TEST_PHONE, 'hey');
  r?.includes("I'm Rally")
    ? ok('greeting → redirect (NOT welcome)') : bad(`unexpected: ${r?.slice(0,80)}`);

  r = await postSms(TEST_PHONE, 'BROADCAST hello');
  r?.includes("I'm Rally")
    ? ok('BROADCAST keyword → redirect (no longer routes)') : bad(`unexpected: ${r?.slice(0,80)}`);

  r = await postSms(TEST_PHONE, 'INVITE Sarah +15551234567');
  r?.includes("I'm Rally")
    ? ok('INVITE keyword → redirect (no longer routes)') : bad(`unexpected: ${r?.slice(0,80)}`);

  r = await postSms(TEST_PHONE, 'APP');
  r?.includes('Get the app:')
    ? ok('APP keyword still works') : bad(`APP failed: ${r?.slice(0,80)}`);

  r = await postSms(TEST_PHONE, 'STOP');
  r?.toLowerCase().includes('opted out')
    ? ok('STOP returns opt-out confirmation') : bad(`STOP failed: ${r?.slice(0,80)}`);

  // Verify users.opted_out=true
  const { data: stoppedUser } = await sb.from('users').select('opted_out').eq('phone', TEST_PHONE).single();
  stoppedUser?.opted_out === true ? ok('STOP set users.opted_out=true') : bad('opted_out not flipped');

  r = await postSms(TEST_PHONE, 'REJOIN');
  r?.toLowerCase().includes('welcome back')
    ? ok('REJOIN returns confirmation') : bad(`REJOIN failed: ${r?.slice(0,80)}`);

  const { data: rejoinedUser } = await sb.from('users').select('opted_out').eq('phone', TEST_PHONE).single();
  rejoinedUser?.opted_out === false ? ok('REJOIN set users.opted_out=false') : bad('opted_out not flipped back');

  // Idempotency: same MessageSid twice → second is silent
  const dupeSid = `SM_dupe_${Date.now()}`;
  await fetch(`${SUPABASE_URL}/functions/v1/sms-inbound`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ MessageSid: dupeSid, From: TEST_PHONE, To: RALLY_PHONE, Body: 'first', NumMedia: '0' }).toString(),
  });
  const dupRes = await fetch(`${SUPABASE_URL}/functions/v1/sms-inbound`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ MessageSid: dupeSid, From: TEST_PHONE, To: RALLY_PHONE, Body: 'first', NumMedia: '0' }).toString(),
  });
  const dupText = await dupRes.text();
  /<Response><\/Response>/.test(dupText) || !/<Message>/.test(dupText)
    ? ok('duplicate MessageSid → empty TwiML (idempotent)') : bad(`duplicate not idempotent: ${dupText.slice(0,80)}`);

  // ─── 5. /status/[token] data layer ────────────────────────────────────────
  section('5. /status/[token] DATA LAYER');
  {
    const { data: anonTrip, error } = await sb.from('trips')
      .select('id, name, destination, start_date, end_date, share_token')
      .eq('share_token', trip.share_token).eq('status', 'active').single();
    !error && anonTrip ? ok('getTripByShareToken-style read works') : bad(`error: ${error?.message}`);
    anonTrip?.destination === 'Costa Rica' ? ok('destination correct') : bad('destination wrong');
  }

  // ─── 6. Account claim check ───────────────────────────────────────────────
  section('6. ACCOUNT CLAIM CHECK');
  {
    // Planner's auth_user_id is null; check_claim_available should return true
    const { data: claimable } = await sb.rpc('check_claim_available', { p_phone: PLANNER_PHONE });
    claimable === true ? ok('check_claim_available returns true for unclaimed phone') : bad(`returned ${claimable}`);

    // Random untouched phone should return false
    const { data: notClaimable } = await sb.rpc('check_claim_available', { p_phone: '+12025551111' });
    notClaimable === false ? ok('check_claim_available returns false for random phone') : bad(`returned ${notClaimable}`);
  }

  // ─── 7. Phase 4 dashboard data ────────────────────────────────────────────
  section('7. DASHBOARD DATA LAYER');
  {
    const { data: parts } = await sb.from('trip_session_participants')
      .select('phone, display_name, is_planner, is_attending, status')
      .eq('trip_session_id', session.id).order('joined_at');
    parts?.length === 2 ? ok('2 participants visible (planner + friend)') : bad(`got ${parts?.length}`);
    parts?.find(p => p.phone === PLANNER_PHONE)?.is_planner ? ok('planner row marked is_planner=true') : bad('planner flag wrong');
    parts?.find(p => p.phone === FRIEND_PHONE)?.is_attending ? ok('friend row marked is_attending=true') : bad('friend attending wrong');
  }

  // ─── 8. Phase 4.5 activity feed ───────────────────────────────────────────
  section('8. ACTIVITY FEED');
  {
    // Insert a simulated planner_broadcast row
    await sb.from('thread_messages').insert({
      thread_id: `broadcast_${session.id}`,
      trip_session_id: session.id,
      direction: 'outbound',
      sender_phone: null,
      sender_role: 'planner_broadcast',
      body: 'Test broadcast for activity feed',
      message_sid: null,
    });

    // Fetch the same way the dashboard does
    const [{ data: broadcasts }, { data: parts }] = await Promise.all([
      sb.from('thread_messages')
        .select('body, created_at')
        .eq('trip_session_id', session.id)
        .eq('sender_role', 'planner_broadcast')
        .order('created_at', { ascending: false }).limit(20),
      sb.from('trip_session_participants')
        .select('id, display_name, phone, joined_at, status')
        .eq('trip_session_id', session.id).order('joined_at', { ascending: false }).limit(20),
    ]);
    broadcasts?.length >= 1 ? ok(`${broadcasts.length} broadcast(s) in feed`) : bad('no broadcasts visible');
    parts?.length === 2 ? ok(`${parts.length} participant joins in feed`) : bad(`got ${parts?.length}`);
  }

  // ─── Cleanup ──────────────────────────────────────────────────────────────
  section('CLEANUP');
  await sb.from('trips').delete().eq('id', trip.id);
  await sb.from('users').delete().eq('phone', PLANNER_PHONE);
  await sb.from('users').delete().eq('phone', FRIEND_PHONE);
  await sb.from('users').delete().eq('phone', TEST_PHONE);
  ok('test data removed');

  // ─── Summary ──────────────────────────────────────────────────────────────
  console.log(`\n${'═'.repeat(60)}\n  RESULTS\n${'═'.repeat(60)}`);
  console.log(`  ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((err) => {
  console.error('Fatal:', err);
  process.exit(2);
});
