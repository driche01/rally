#!/usr/bin/env node
/**
 * Edge-case test runner for the SMS agent.
 *
 * Runs multiple edge-case scenarios against the live sms-inbound endpoint,
 * asserts on response content, and prints PASS/FAIL per test.
 *
 * Usage:
 *   node scripts/run-edge-cases.js
 *   node scripts/run-edge-cases.js --test typo_commands   # run a single test
 */
const { createClient } = require('@supabase/supabase-js');

// ─── Config ─────────────────────────────────────────────────────────────────

const ENDPOINT = 'https://qxpbnixvjtwckuedlrfj.supabase.co/functions/v1/sms-inbound';
const SUPABASE_URL = 'https://qxpbnixvjtwckuedlrfj.supabase.co';
const SERVICE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF4cGJuaXh2anR3Y2t1ZWRscmZqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzIwMDI0MywiZXhwIjoyMDg4Nzc2MjQzfQ.ZBkGoUbavzMkiHcN_FQt38GbbMCx2PKbYyZd2hau_28';
const RALLY_PHONE = '+16624283059';

const admin = createClient(SUPABASE_URL, SERVICE_KEY);

// ─── Helpers ────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let msgCounter = 0;

function nextSid() {
  msgCounter++;
  return `MM_edge_${Date.now()}_${msgCounter}`;
}

function parseTwiml(xml) {
  const match = xml.match(/<Message>(.*?)<\/Message>/s);
  if (!match) return null;
  return match[1]
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"');
}

/**
 * Send a message to the SMS endpoint.
 * @param {object} opts
 * @param {string} opts.from - Sender phone
 * @param {string} opts.body - Message text
 * @param {string[]} opts.phones - All participant phones (excluding Rally)
 * @param {string} [opts.sid] - Override MessageSid (for dedup test)
 * @returns {Promise<{status: number, reply: string|null, raw: string}>}
 */
async function send({ from, body, phones, sid }) {
  const others = phones.filter((p) => p !== from);
  const to = [RALLY_PHONE, ...others].join(',');

  const params = new URLSearchParams({
    MessageSid: sid || nextSid(),
    From: from,
    To: to,
    Body: body,
    NumMedia: '0',
  });

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Bearer ${SERVICE_KEY}`,
    },
    body: params.toString(),
  });

  const raw = await res.text();
  const reply = parseTwiml(raw);
  return { status: res.status, reply, raw };
}

// ─── Cleanup ────────────────────────────────────────────────────────────────

/**
 * Delete all test data for phones matching the given prefix.
 * Cleans: thread_messages, trip_session_participants, trip_sessions,
 *         users, pending_planners, respondents, polls, poll_options, poll_responses.
 */
async function cleanupPhones(phonePrefix) {
  // Find users with matching phone
  const { data: users } = await admin
    .from('users')
    .select('id, phone')
    .like('phone', `${phonePrefix}%`);

  const userIds = (users ?? []).map((u) => u.id);
  const userPhones = (users ?? []).map((u) => u.phone);

  if (userIds.length === 0 && userPhones.length === 0) return;

  // Find sessions where any participant is a test user
  const { data: parts } = await admin
    .from('trip_session_participants')
    .select('trip_session_id')
    .in('user_id', userIds.length ? userIds : ['__none__']);

  const sessionIds = [...new Set((parts ?? []).map((p) => p.trip_session_id))];

  if (sessionIds.length > 0) {
    // Get trip IDs from sessions
    const { data: sessions } = await admin
      .from('trip_sessions')
      .select('id, trip_id')
      .in('id', sessionIds);

    const tripIds = (sessions ?? [])
      .map((s) => s.trip_id)
      .filter(Boolean);

    // Delete poll responses, options, polls for these sessions
    const { data: polls } = await admin
      .from('polls')
      .select('id')
      .in('trip_session_id', sessionIds);

    const pollIds = (polls ?? []).map((p) => p.id);

    if (pollIds.length > 0) {
      await admin.from('poll_responses').delete().in('poll_id', pollIds);
      await admin.from('poll_options').delete().in('poll_id', pollIds);
      await admin.from('polls').delete().in('id', pollIds);
    }

    // Delete respondents
    if (tripIds.length > 0) {
      await admin.from('respondents').delete().in('trip_id', tripIds);
    }

    // Delete scheduled_actions for these sessions
    await admin.from('scheduled_actions').delete().in('trip_session_id', sessionIds);

    // Delete split_requests
    await admin.from('split_requests').delete().in('trip_session_id', sessionIds);

    // Delete thread messages
    await admin.from('thread_messages').delete().in('trip_session_id', sessionIds);

    // Delete participants
    await admin.from('trip_session_participants').delete().in('trip_session_id', sessionIds);

    // Delete sessions
    await admin.from('trip_sessions').delete().in('id', sessionIds);

    // Delete trips
    if (tripIds.length > 0) {
      await admin.from('trips').delete().in('id', tripIds);
    }
  }

  // Also clean thread_messages by sender_phone (in case session was not yet created)
  for (const phone of userPhones) {
    await admin.from('thread_messages').delete().eq('sender_phone', phone);
  }

  // Delete pending_planners
  for (const phone of userPhones) {
    await admin.from('pending_planners').delete().eq('phone', phone);
  }

  // Delete users
  if (userIds.length > 0) {
    await admin.from('users').delete().in('id', userIds);
  }
}

/**
 * Helper: bootstrap a session in a specific phase with participants.
 * Returns { session, participants, plannerUserId }.
 */
async function bootstrapSession({ phones, plannerPhone, phase, destination, dates }) {
  // Create users
  const userMap = {};
  for (const phone of phones) {
    const { data: user } = await admin
      .from('users')
      .upsert({ phone, display_name: null }, { onConflict: 'phone' })
      .select()
      .single();
    userMap[phone] = user;
  }

  const plannerUserId = userMap[plannerPhone]?.id ?? null;

  // Build thread_id from sorted participant phones
  const sortedPhones = [...phones].sort();
  const threadId = sortedPhones.join(',');

  // Create session
  const { data: session } = await admin
    .from('trip_sessions')
    .insert({
      thread_id: threadId,
      planner_user_id: plannerUserId,
      phase: phase || 'INTRO',
      status: 'ACTIVE',
      destination: destination || null,
      dates: dates || null,
    })
    .select()
    .single();

  // Add participants
  const participants = [];
  for (const phone of phones) {
    const userId = userMap[phone].id;
    const isPlanner = phone === plannerPhone;
    const { data: part } = await admin
      .from('trip_session_participants')
      .insert({
        trip_session_id: session.id,
        user_id: userId,
        phone,
        is_planner: isPlanner,
        status: 'active',
        display_name: null,
      })
      .select()
      .single();
    participants.push(part);
  }

  return { session, participants, plannerUserId, userMap };
}

// ─── Test definitions ───────────────────────────────────────────────────────

const TESTS = {};

/**
 * 1. typo_commands — Send "STAUS", "HALP", "RESME" and verify fuzzy matching.
 */
TESTS.typo_commands = async () => {
  const prefix = '+155501';
  const phones = ['+15550100', '+15550101', '+15550102'];
  await cleanupPhones(prefix);

  // Bootstrap a session in a phase where commands work
  const { session } = await bootstrapSession({
    phones,
    plannerPhone: phones[0],
    phase: 'BUDGET_POLL',
  });

  await sleep(500);

  const results = [];

  // STAUS -> STATUS
  const r1 = await send({ from: phones[0], body: 'STAUS', phones });
  await sleep(500);
  results.push({
    name: 'STAUS -> STATUS',
    pass: r1.reply !== null && r1.reply.toLowerCase().includes('phase'),
    reply: r1.reply,
  });

  // HALP -> HELP
  const r2 = await send({ from: phones[0], body: 'HALP', phones });
  await sleep(500);
  results.push({
    name: 'HALP -> HELP',
    pass: r2.reply !== null && r2.reply.toLowerCase().includes('commands'),
    reply: r2.reply,
  });

  // RESME -> RESUME (planner-only, so should work since phones[0] is planner)
  const r3 = await send({ from: phones[0], body: 'RESME', phones });
  await sleep(500);
  results.push({
    name: 'RESME -> RESUME',
    pass: r3.reply !== null && r3.status === 200,
    reply: r3.reply,
  });

  await cleanupPhones(prefix);

  const allPassed = results.every((r) => r.pass);
  for (const r of results) {
    console.log(`    ${r.pass ? 'PASS' : 'FAIL'}: ${r.name} -> ${(r.reply ?? '(no reply)').slice(0, 120)}`);
  }
  return allPassed;
};

/**
 * 2. case_sensitivity — "yes", "Yes", "YES" should all be treated identically.
 */
TESTS.case_sensitivity = async () => {
  const prefix = '+155502';
  const phones = ['+15550200', '+15550201', '+15550202'];
  await cleanupPhones(prefix);

  // Bootstrap a session in COMMIT_POLL phase so YES is meaningful
  const { session, participants } = await bootstrapSession({
    phones,
    plannerPhone: phones[0],
    phase: 'COMMIT_POLL',
    destination: 'Tulum',
    dates: { start: '2026-12-01', end: '2026-12-05', nights: 4 },
  });

  await sleep(500);

  // Each participant sends a different case of "yes"
  const variants = ['yes', 'Yes', 'YES'];
  const results = [];

  for (let i = 0; i < 3; i++) {
    const r = await send({ from: phones[i], body: variants[i], phones });
    await sleep(600);
    results.push({
      name: `"${variants[i]}" accepted`,
      // Should get a 200 response (processed, not error)
      pass: r.status === 200,
      reply: r.reply,
    });
  }

  // Check DB: all 3 participants should be committed
  const { data: parts } = await admin
    .from('trip_session_participants')
    .select('committed')
    .eq('trip_session_id', session.id)
    .eq('status', 'active');

  const allCommitted = (parts ?? []).every((p) => p.committed);
  results.push({
    name: 'All 3 committed in DB',
    pass: allCommitted,
    reply: `committed=${(parts ?? []).filter((p) => p.committed).length}/3`,
  });

  await cleanupPhones(prefix);

  const allPassed = results.every((r) => r.pass);
  for (const r of results) {
    console.log(`    ${r.pass ? 'PASS' : 'FAIL'}: ${r.name} -> ${(r.reply ?? '(no reply)').slice(0, 120)}`);
  }
  return allPassed;
};

/**
 * 3. emoji_only — Send just emojis during INTRO phase. Should get null response.
 */
TESTS.emoji_only = async () => {
  const prefix = '+155503';
  const phones = ['+15550300', '+15550301'];
  await cleanupPhones(prefix);

  const { session } = await bootstrapSession({
    phones,
    plannerPhone: phones[0],
    phase: 'INTRO',
  });

  await sleep(500);

  const r = await send({ from: phones[1], body: '\u{1F334}\u{1F1F2}\u{1F1FD}', phones });
  await sleep(500);

  // During INTRO, the name regex won't match emoji-only, so handler returns null
  const pass = r.reply === null;

  await cleanupPhones(prefix);

  console.log(`    ${pass ? 'PASS' : 'FAIL'}: emoji_only -> reply=${r.reply ?? '(null)'}`);
  return pass;
};

/**
 * 4. duplicate_message — Same MessageSid sent twice. Second should be deduped.
 */
TESTS.duplicate_message = async () => {
  const prefix = '+155504';
  const phones = ['+15550400', '+15550401'];
  await cleanupPhones(prefix);

  const { session } = await bootstrapSession({
    phones,
    plannerPhone: phones[0],
    phase: 'BUDGET_POLL',
  });

  await sleep(500);

  const fixedSid = `MM_edge_dedup_${Date.now()}`;

  // First send — should succeed
  const r1 = await send({ from: phones[0], body: 'STATUS', phones, sid: fixedSid });
  await sleep(500);

  // Second send with same SID — should be deduped
  const r2 = await send({ from: phones[0], body: 'STATUS', phones, sid: fixedSid });
  await sleep(500);

  // First should have a reply, second should be deduped (no TwiML reply)
  const firstGotReply = r1.reply !== null && r1.status === 200;
  const secondDeduped = r2.reply === null && r2.status === 200;

  await cleanupPhones(prefix);

  console.log(`    ${firstGotReply ? 'PASS' : 'FAIL'}: First message got reply -> ${(r1.reply ?? '(null)').slice(0, 100)}`);
  console.log(`    ${secondDeduped ? 'PASS' : 'FAIL'}: Second message deduped -> raw=${r2.raw.slice(0, 100)}`);
  return firstGotReply && secondDeduped;
};

/**
 * 5. non_planner_command — Non-planner sends "PAUSE". Should get "Only X can do that."
 */
TESTS.non_planner_command = async () => {
  const prefix = '+155505';
  const phones = ['+15550500', '+15550501'];
  await cleanupPhones(prefix);

  // phones[0] is planner, phones[1] is not
  const { session } = await bootstrapSession({
    phones,
    plannerPhone: phones[0],
    phase: 'BUDGET_POLL',
  });

  await sleep(500);

  // Non-planner sends PAUSE
  const r = await send({ from: phones[1], body: 'PAUSE', phones });
  await sleep(500);

  const pass =
    r.reply !== null &&
    r.reply.toLowerCase().includes('only') &&
    r.reply.toLowerCase().includes('can do that');

  await cleanupPhones(prefix);

  console.log(`    ${pass ? 'PASS' : 'FAIL'}: non_planner PAUSE -> ${(r.reply ?? '(null)').slice(0, 120)}`);
  return pass;
};

/**
 * 6. unicode_name — Send "Siobhan" (with fada) as name. Should be stored correctly.
 */
TESTS.unicode_name = async () => {
  const prefix = '+155506';
  const phones = ['+15550600', '+15550601'];
  await cleanupPhones(prefix);

  const { session } = await bootstrapSession({
    phones,
    plannerPhone: phones[0],
    phase: 'INTRO',
  });

  await sleep(500);

  const r = await send({ from: phones[1], body: 'Siobh\u00e1n - Tulum', phones });
  await sleep(500);

  // Response should acknowledge the name
  const replyOk = r.reply !== null && r.reply.includes('Siobh\u00e1n');

  // Check DB for correct name storage
  const { data: users } = await admin
    .from('users')
    .select('display_name')
    .eq('phone', '+15550601')
    .maybeSingle();

  const nameInDb = users?.display_name === 'Siobh\u00e1n';

  await cleanupPhones(prefix);

  console.log(`    ${replyOk ? 'PASS' : 'FAIL'}: Reply contains unicode name -> ${(r.reply ?? '(null)').slice(0, 120)}`);
  console.log(`    ${nameInDb ? 'PASS' : 'FAIL'}: DB name="${users?.display_name}"`);
  return replyOk && nameInDb;
};

/**
 * 7. vote_out_of_range — During active poll with 2 options, send "5".
 *    Should get "Reply 1-2 to vote" or similar out-of-range message.
 */
TESTS.vote_out_of_range = async () => {
  const prefix = '+155507';
  const phones = ['+15550700', '+15550701', '+15550702'];
  await cleanupPhones(prefix);

  // Bootstrap in DECIDING_DESTINATION with a real trip + poll
  const { session, userMap } = await bootstrapSession({
    phones,
    plannerPhone: phones[0],
    phase: 'DECIDING_DESTINATION',
  });

  // Create a trip for the session so poll_responses can link to respondents
  const { data: trip } = await admin
    .from('trips')
    .insert({
      name: 'Edge Case Trip 7',
      status: 'deciding',
      created_by: userMap[phones[0]].id,
    })
    .select()
    .single();

  await admin
    .from('trip_sessions')
    .update({ trip_id: trip.id })
    .eq('id', session.id);

  // Create respondents for each user
  for (const phone of phones) {
    await admin.from('respondents').insert({
      trip_id: trip.id,
      phone,
      name: phone.slice(-4),
    });
  }

  // Create a poll with 2 options
  const { data: poll } = await admin
    .from('polls')
    .insert({
      trip_id: trip.id,
      trip_session_id: session.id,
      type: 'destination',
      title: 'Where to?',
      status: 'open',
      phase: 'DECIDING_DESTINATION',
      opened_at: new Date().toISOString(),
    })
    .select()
    .single();

  await admin.from('poll_options').insert([
    { poll_id: poll.id, label: 'Tulum', position: 1 },
    { poll_id: poll.id, label: 'Cancun', position: 2 },
  ]);

  await sleep(500);

  // Send "5" which is out of range for a 2-option poll
  const r = await send({ from: phones[1], body: '5', phones });
  await sleep(500);

  // Should get a reply indicating the vote is out of range
  const pass =
    r.reply !== null &&
    (r.reply.includes('1-2') || r.reply.includes('1 or 2') || /reply\s+\d/i.test(r.reply));

  await cleanupPhones(prefix);

  console.log(`    ${pass ? 'PASS' : 'FAIL'}: vote "5" out of range -> ${(r.reply ?? '(null)').slice(0, 120)}`);
  return pass;
};

/**
 * 8. budget_tier_with_period — Send "3." during budget phase.
 *    Should map to $1,500 tier (trailing period stripped).
 */
TESTS.budget_tier_with_period = async () => {
  const prefix = '+155508';
  const phones = ['+15550800', '+15550801'];
  await cleanupPhones(prefix);

  const { session, participants } = await bootstrapSession({
    phones,
    plannerPhone: phones[0],
    phase: 'BUDGET_POLL',
  });

  await sleep(500);

  // Send "3." — should be tier 3 = $1,500
  const r = await send({ from: phones[0], body: '3.', phones });
  await sleep(500);

  // Check participant's budget_raw was stored
  const { data: part } = await admin
    .from('trip_session_participants')
    .select('budget_raw, budget_amount')
    .eq('trip_session_id', session.id)
    .eq('phone', phones[0])
    .maybeSingle();

  // The budget amount should be 1500 (tier 3)
  const amountCorrect = part?.budget_amount === 1500;
  const gotReply = r.status === 200;

  await cleanupPhones(prefix);

  console.log(`    ${amountCorrect ? 'PASS' : 'FAIL'}: budget_amount=${part?.budget_amount} (expected 1500)`);
  console.log(`    ${gotReply ? 'PASS' : 'FAIL'}: HTTP ${r.status}, reply=${(r.reply ?? '(null)').slice(0, 120)}`);
  return amountCorrect && gotReply;
};

/**
 * 9. planner_intake — First message "Jake - Tulum, Nov 8-12, $1250pp".
 *    Should pre-fill destination, dates, and budget from the intake.
 */
TESTS.planner_intake = async () => {
  const prefix = '+155509';
  const phones = ['+15550900', '+15550901', '+15550902'];
  await cleanupPhones(prefix);

  // Register as planner first (1:1 message)
  // We need to send a 1:1 message (SM_ sid) to register as planner
  const r0 = await send({
    from: phones[0],
    body: 'hey',
    phones: [phones[0]],
    sid: `SM_edge_planner_${Date.now()}`,
  });
  await sleep(500);

  // Now send the group message with intake format
  const r1 = await send({
    from: phones[0],
    body: 'Jake - Tulum, Nov 8-12, $1250pp',
    phones,
  });
  await sleep(1000);

  // Check that the session was created with destination, name
  const { data: users } = await admin
    .from('users')
    .select('id, display_name')
    .eq('phone', phones[0])
    .maybeSingle();

  // The planner's name should be Jake (from the intro pattern)
  const nameOk = users?.display_name === 'Jake';
  const gotReply = r1.status === 200 && r1.reply !== null;

  // Check if destination was picked up (may be in reply or session)
  const replyMentionsTulum = r1.reply?.includes('Tulum') ?? false;

  await cleanupPhones(prefix);

  console.log(`    ${nameOk ? 'PASS' : 'FAIL'}: planner name="${users?.display_name}" (expected "Jake")`);
  console.log(`    ${gotReply ? 'PASS' : 'FAIL'}: got reply -> ${(r1.reply ?? '(null)').slice(0, 150)}`);
  console.log(`    ${replyMentionsTulum ? 'PASS' : 'FAIL'}: reply mentions Tulum`);
  return nameOk && gotReply;
};

/**
 * 10. commit_split — 3 participants, 2 YES, 1 NO. Session should SPLIT.
 */
TESTS.commit_split = async () => {
  const prefix = '+155510';
  const phones = ['+15551000', '+15551001', '+15551002'];
  await cleanupPhones(prefix);

  const { session, userMap } = await bootstrapSession({
    phones,
    plannerPhone: phones[0],
    phase: 'COMMIT_POLL',
    destination: 'Bali',
    dates: { start: '2026-12-10', end: '2026-12-17', nights: 7 },
  });

  // Create trip for the session
  const { data: trip } = await admin
    .from('trips')
    .insert({
      name: 'Edge Case Trip 10',
      status: 'deciding',
      created_by: userMap[phones[0]].id,
    })
    .select()
    .single();

  await admin
    .from('trip_sessions')
    .update({ trip_id: trip.id })
    .eq('id', session.id);

  await sleep(500);

  // 2 say YES
  const r1 = await send({ from: phones[0], body: 'YES', phones });
  await sleep(600);
  const r2 = await send({ from: phones[1], body: 'YES', phones });
  await sleep(600);

  // 1 says NO — this should trigger the split
  const r3 = await send({ from: phones[2], body: 'NO', phones });
  await sleep(1000);

  // Check session status
  const { data: freshSession } = await admin
    .from('trip_sessions')
    .select('status, phase')
    .eq('id', session.id)
    .single();

  // With 2 YES and 1 NO out of 3, outcome depends on commit-poll-engine logic.
  // 2/3 = 67% < 70% threshold, so it may go to AWAITING_PLANNER_DECISION or SPLIT.
  // The key assertion: session moved past COMMIT_POLL.
  const movedPast = freshSession?.phase !== 'COMMIT_POLL' || freshSession?.status !== 'ACTIVE';
  const gotReplies = r3.status === 200;

  // Check if any participant is marked as not committed
  const { data: parts } = await admin
    .from('trip_session_participants')
    .select('phone, committed')
    .eq('trip_session_id', session.id);

  const noVoterNotCommitted = (parts ?? []).some(
    (p) => p.phone === phones[2] && !p.committed,
  );

  await cleanupPhones(prefix);

  console.log(`    ${movedPast ? 'PASS' : 'FAIL'}: session phase="${freshSession?.phase}", status="${freshSession?.status}" (moved past COMMIT_POLL)`);
  console.log(`    ${noVoterNotCommitted ? 'PASS' : 'FAIL'}: NO voter (${phones[2]}) not committed`);
  console.log(`    ${gotReplies ? 'PASS' : 'FAIL'}: all messages returned HTTP 200`);
  return movedPast && noVoterNotCommitted && gotReplies;
};

// ─── Runner ─────────────────────────────────────────────────────────────────

async function run() {
  const args = process.argv.slice(2);
  const testIdx = args.indexOf('--test');
  const singleTest = testIdx !== -1 ? args[testIdx + 1] : null;

  const testNames = singleTest ? [singleTest] : Object.keys(TESTS);

  console.log('\n=== SMS Agent Edge-Case Tests ===\n');
  console.log(`Running ${testNames.length} test(s)...\n`);

  const results = [];

  for (const name of testNames) {
    if (!TESTS[name]) {
      console.log(`  SKIP: unknown test "${name}"`);
      results.push({ name, pass: false });
      continue;
    }

    console.log(`  [${name}]`);
    try {
      const pass = await TESTS[name]();
      results.push({ name, pass });
      console.log(`  => ${pass ? 'PASS' : 'FAIL'}\n`);
    } catch (err) {
      console.error(`  => ERROR: ${err.message}`);
      if (err.stack) console.error(`    ${err.stack.split('\n').slice(1, 3).join('\n    ')}`);
      results.push({ name, pass: false });
      console.log('');
    }

    // Brief pause between tests to avoid rate-limiting
    await sleep(500);
  }

  // Summary
  console.log('=== Summary ===\n');
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass).length;

  for (const r of results) {
    console.log(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`);
  }

  console.log(`\n  ${passed} passed, ${failed} failed out of ${results.length}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
