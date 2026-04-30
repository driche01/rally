#!/usr/bin/env node
/**
 * Cadence + recommendation engine verification.
 *
 * End-to-end smoke test for the survey-based 1:1 SMS pivot. Runs against
 * production with the service-role key. Creates a fixture trip, exercises
 * the full lifecycle (book-by → cadence seed → response → recommendation
 * → approve), and cleans up. Does NOT trigger real SMS sends — the test
 * trip uses fake +1555 phones which Twilio rejects but the server-side
 * DB invariants still execute.
 *
 * Usage: node scripts/run-cadence-verification.js
 */
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://qxpbnixvjtwckuedlrfj.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY env var required'); process.exit(1);
}

const sb = createClient(SUPABASE_URL, SERVICE_KEY);

let passed = 0;
let failed = 0;
const cleanup = [];

function ok(msg)  { console.log(`  ✅ ${msg}`); passed += 1; }
function bad(msg) { console.error(`  ❌ ${msg}`); failed += 1; }
function section(name) { console.log(`\n${'═'.repeat(60)}\n  ${name}\n${'═'.repeat(60)}`); }

const SUFFIX = `cadence_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

async function getTestProfile() {
  // Use any existing profile so trips.created_by FK is satisfied.
  const { data } = await sb.from('profiles').select('id, name').limit(1).maybeSingle();
  if (!data) throw new Error('No profiles in DB — cannot run test');
  return data;
}

async function main() {
  const profile = await getTestProfile();
  console.log(`Using fixture planner: ${profile.name} (${profile.id})`);

  // ─── 1. Book-by trigger ─────────────────────────────────────────────────
  section('Trigger: trips_default_responses_due_date');
  const today = new Date();
  const bookBy = new Date(today.getTime() + 30 * 86400000); // 30 days out
  const bookByISO = bookBy.toISOString().slice(0, 10);

  const { data: trip, error: tripErr } = await sb.from('trips').insert({
    created_by: profile.id,
    name: `__${SUFFIX}__trip`,
    group_size_bucket: '5-8',
    share_token: SUFFIX,
    status: 'active',
    book_by_date: bookByISO,
    destination: 'Cancun',
  }).select().single();
  if (tripErr) { bad(`trip insert: ${tripErr.message}`); return; }
  cleanup.push(['trips', trip.id]);

  const expectedDue = new Date(bookBy.getTime() - 3 * 86400000).toISOString().slice(0, 10);
  if (trip.responses_due_date === expectedDue) ok(`responses_due_date auto-derived to ${expectedDue}`);
  else bad(`expected ${expectedDue}, got ${trip.responses_due_date}`);

  // Update book_by → expect responses_due to follow.
  const newBookBy = new Date(today.getTime() + 60 * 86400000).toISOString().slice(0, 10);
  const { data: updated } = await sb.from('trips').update({ book_by_date: newBookBy })
    .eq('id', trip.id).select('book_by_date, responses_due_date').single();
  const newExpected = new Date(new Date(newBookBy).getTime() - 3 * 86400000).toISOString().slice(0, 10);
  if (updated.responses_due_date === newExpected) ok(`UPDATE recomputed responses_due to ${newExpected}`);
  else bad(`expected ${newExpected}, got ${updated.responses_due_date}`);

  // Override: explicit responses_due in same UPDATE preserved.
  const overrideDate = new Date(today.getTime() + 50 * 86400000).toISOString().slice(0, 10);
  const { data: overridden } = await sb.from('trips').update({
    book_by_date: new Date(today.getTime() + 70 * 86400000).toISOString().slice(0, 10),
    responses_due_date: overrideDate,
  }).eq('id', trip.id).select('responses_due_date').single();
  if (overridden.responses_due_date === overrideDate) ok('explicit responses_due override preserved');
  else bad(`expected ${overrideDate}, got ${overridden.responses_due_date}`);

  // ─── 2. trip_session + participant setup ────────────────────────────────
  section('Setup: trip_session + participants');
  const { data: ses, error: sesErr } = await sb.from('trip_sessions').insert({
    trip_id: trip.id,
    planner_user_id: null,  // OK for nudge_sends — we just need session_id
    phase: 'INTRO',
    status: 'ACTIVE',
    last_message_at: new Date().toISOString(),
    thread_id: `__${SUFFIX}__thread`,
  }).select().single();
  if (sesErr) { bad(`session insert: ${sesErr.message}`); await runCleanup(); return; }
  cleanup.push(['trip_sessions', ses.id]);
  ok(`trip_session created: ${ses.id}`);

  // Two non-planner participants
  const phones = [`+1555${SUFFIX.slice(-7).padStart(7, '0')}`.slice(0, 12), `+1555${(parseInt(SUFFIX.slice(-7).padStart(7, '0').replace(/\D/g, '0'), 10) + 1).toString().padStart(7, '0')}`.slice(0, 12)];
  const partRows = [];
  for (let i = 0; i < 2; i++) {
    const { data: p, error } = await sb.from('trip_session_participants').insert({
      trip_session_id: ses.id,
      phone: phones[i],
      display_name: `Test Person ${i + 1}`,
      status: 'active',
      is_attending: true,
      is_planner: false,
    }).select().single();
    if (error) { bad(`participant insert: ${error.message}`); await runCleanup(); return; }
    partRows.push(p);
  }
  ok(`2 participants created`);

  // ─── 3. Reset book_by to a sensible value, invoke scheduler, expect seed ────
  section('Scheduler: SEED pass');
  await sb.from('trips').update({
    book_by_date: bookByISO,
    responses_due_date: null,  // let trigger re-derive
  }).eq('id', trip.id);
  // Trigger writes responses_due = book_by - 3
  const { data: tripAfter } = await sb.from('trips').select('responses_due_date').eq('id', trip.id).single();
  if (tripAfter.responses_due_date) ok(`trip re-derived responses_due: ${tripAfter.responses_due_date}`);
  else bad('responses_due_date null after re-derive');

  const schedRes1 = await fetch(`${SUPABASE_URL}/functions/v1/sms-nudge-scheduler`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SERVICE_KEY}`,
    },
    body: '{}',
  });
  const sched1 = await schedRes1.json();
  if (sched1.ok) ok(`scheduler returned ok with sessions=${sched1.seed?.sessions ?? 0}`);
  else bad(`scheduler failed: ${JSON.stringify(sched1)}`);

  const { data: nudges } = await sb.from('nudge_sends').select('id, nudge_type').eq('trip_session_id', ses.id);
  // Per participant we expect at least 'initial', 'd1', 'd3', 'rd_minus_2', 'rd_minus_1' (5 kinds)
  // Across 2 participants: at least 10 rows, possibly + heartbeats (none for 30-day window — collapses)
  if ((nudges?.length ?? 0) >= 8) ok(`${nudges.length} nudge_sends rows seeded`);
  else bad(`expected ≥8 nudge_sends, got ${nudges?.length ?? 0}`);

  // ─── 4. Reseed-on-book-by-change trigger ────────────────────────────────
  section('Trigger: trips_reseed_nudges_on_due_change');
  const beforePending = nudges?.length ?? 0;
  await sb.from('trips').update({
    book_by_date: new Date(today.getTime() + 90 * 86400000).toISOString().slice(0, 10),
    responses_due_date: null,
  }).eq('id', trip.id);
  const { data: afterUpdate } = await sb.from('nudge_sends')
    .select('id, sent_at, skipped_at, skip_reason')
    .eq('trip_session_id', ses.id);
  const skipped = (afterUpdate ?? []).filter((r) => r.skip_reason === 'book_by_changed').length;
  if (skipped >= beforePending - 1) ok(`${skipped}/${beforePending} pending nudges soft-canceled (book_by_changed)`);
  else bad(`expected ~${beforePending} cancellations, got ${skipped}`);

  // ─── 5. Recommendation engine ───────────────────────────────────────────
  section('Recommendation engine: poll + responses → recommendation');
  const { data: poll } = await sb.from('polls').insert({
    trip_id: trip.id,
    type: 'destination',
    title: 'Pick a spot',
    status: 'live',
    position: 1,
  }).select().single();
  const { data: optA } = await sb.from('poll_options').insert({
    poll_id: poll.id, label: 'Cancun', position: 1,
  }).select().single();
  const { data: optB } = await sb.from('poll_options').insert({
    poll_id: poll.id, label: 'Tulum', position: 2,
  }).select().single();

  // Both test phones vote for optA via respondents/poll_responses
  for (let i = 0; i < 2; i++) {
    const { data: respondent } = await sb.from('respondents').insert({
      trip_id: trip.id,
      name: `Test Person ${i + 1}`,
      phone: phones[i],
      session_token: `__${SUFFIX}__r${i}`,
      rsvp: 'in',
    }).select().single();
    await sb.from('poll_responses').insert({
      poll_id: poll.id,
      respondent_id: respondent.id,
      option_id: optA.id,
    });
  }
  ok('2 responses recorded for Cancun');

  // Push responses_due into the past, invoke scheduler — should auto-create rec
  const pastDate = new Date(today.getTime() - 1 * 86400000).toISOString().slice(0, 10);
  await sb.from('trips').update({ responses_due_date: pastDate }).eq('id', trip.id);
  const schedRes2 = await fetch(`${SUPABASE_URL}/functions/v1/sms-nudge-scheduler`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SERVICE_KEY}`,
    },
    body: '{}',
  });
  const sched2 = await schedRes2.json();
  if ((sched2.seed?.recommendations_created ?? 0) >= 1) ok(`scheduler auto-created ${sched2.seed.recommendations_created} recommendation(s)`);
  else bad(`expected ≥1 recommendation, got ${sched2.seed?.recommendations_created ?? 0}`);

  const { data: rec } = await sb.from('poll_recommendations').select('*').eq('poll_id', poll.id).maybeSingle();
  if (rec && rec.recommended_option_id === optA.id) ok(`recommendation winner = Cancun (confidence ${rec.confidence})`);
  else bad(`recommendation missing or wrong winner: ${JSON.stringify(rec)}`);
  if (rec && rec.vote_breakdown[optA.id] === 2) ok(`vote_breakdown shows Cancun:2`);
  else bad(`vote_breakdown wrong: ${JSON.stringify(rec?.vote_breakdown)}`);

  // ─── 6. Custom polls flow ───────────────────────────────────────────────
  section('Custom polls: type/status/options/multi-select');
  // The CustomPollsSection UI caps at 3 polls (MAX_POLLS). The cap is
  // UI-enforced, not DB-enforced, so we only assert the per-poll contract
  // here — `createLivePollsFromOptions` in src/lib/api/trips.ts mirrors
  // these inserts.
  const customTrip = await sb.from('trips').insert({
    created_by: profile.id,
    name: `__${SUFFIX}__custom_trip`,
    group_size_bucket: '5-8',
    share_token: `${SUFFIX}_custom`,
    status: 'active',
    book_by_date: bookByISO,
  }).select().single();
  if (customTrip.error) { bad(`custom-trip insert: ${customTrip.error.message}`); await runCleanup(); return; }
  cleanup.push(['trips', customTrip.data.id]);

  // Case A: single custom poll, 2 options, default (single-select)
  const { data: customA, error: customAErr } = await sb.from('polls').insert({
    trip_id: customTrip.data.id,
    type: 'custom',
    title: 'What vibe?',
    status: 'live',
    allow_multi_select: false,
    position: 0,
  }).select().single();
  if (customAErr) { bad(`custom poll A: ${customAErr.message}`); }
  else {
    if (customA.type === 'custom' && customA.status === 'live' && customA.allow_multi_select === false)
      ok(`custom poll A inserted: type=custom status=live allow_multi=false`);
    else bad(`custom poll A wrong shape: ${JSON.stringify(customA)}`);
  }
  const { data: customAOpts, error: customAOptsErr } = await sb.from('poll_options').insert([
    { poll_id: customA.id, label: 'Chill beach', position: 0 },
    { poll_id: customA.id, label: 'Adventure mode', position: 1 },
  ]).select();
  if (customAOptsErr) bad(`poll A options: ${customAOptsErr.message}`);
  else if (customAOpts.length === 2 && customAOpts.every((o, i) => o.position === i))
    ok(`poll A options seeded with sequential positions [0, 1]`);
  else bad(`poll A options wrong: ${JSON.stringify(customAOpts)}`);

  // Case B: three custom polls on a single trip — exercise the MAX_POLLS = 3 cap state
  const customBPolls = [];
  for (let i = 1; i <= 3; i++) {
    const { data: p, error } = await sb.from('polls').insert({
      trip_id: customTrip.data.id,
      type: 'custom',
      title: `Question ${i}`,
      status: 'live',
      allow_multi_select: false,
      position: i, // 0 already taken by customA
    }).select().single();
    if (error) { bad(`custom poll B${i}: ${error.message}`); break; }
    customBPolls.push(p);
  }
  if (customBPolls.length === 3 && customBPolls.every((p, i) => p.position === i + 1))
    ok(`3 custom polls coexist on one trip with sequential positions [1, 2, 3]`);
  else bad(`expected 3 sequential custom polls, got ${customBPolls.length}`);

  // Case C: multi-select roundtrip
  const { data: customC, error: customCErr } = await sb.from('polls').insert({
    trip_id: customTrip.data.id,
    type: 'custom',
    title: 'Pick all that apply',
    status: 'live',
    allow_multi_select: true,
    position: 4,
  }).select().single();
  if (customCErr) bad(`custom poll C: ${customCErr.message}`);
  else if (customC.allow_multi_select === true) ok(`allow_multi_select=true round-trips through polls table`);
  else bad(`allow_multi_select did not round-trip: got ${customC.allow_multi_select}`);

  // ─── 7. Edit-trip diff + reset ──────────────────────────────────────────
  section('Edit-trip: cascade-delete on poll edit + broadcast row contract');
  // Mirrors `rebuildPoll` / `rebuildCustomPoll` in app/(app)/trips/[id]/edit.tsx:
  // when the planner edits a polled field with existing votes, the old poll
  // is deleted and the new one inserted. The DB cascade-deletes the
  // matching poll_responses, which is what produces the "responses reset"
  // behavior the planner sees the warning about.
  //
  // The position-preservation invariant of rebuildPoll / rebuildCustomPoll
  // is exercised by the multi-poll case at the end of this section.
  const { data: editTrip, error: editTripErr } = await sb.from('trips').insert({
    created_by: profile.id,
    name: `__${SUFFIX}__edit_trip`,
    group_size_bucket: '5-8',
    share_token: `${SUFFIX}_edit`,
    status: 'active',
    book_by_date: bookByISO,
  }).select().single();
  if (editTripErr) { bad(`edit-trip insert: ${editTripErr.message}`); await runCleanup(); return; }
  cleanup.push(['trips', editTrip.id]);

  const { data: editPoll } = await sb.from('polls').insert({
    trip_id: editTrip.id,
    type: 'custom',
    title: 'Original question',
    status: 'live',
    allow_multi_select: false,
    position: 0,
  }).select().single();
  const { data: editOpts } = await sb.from('poll_options').insert([
    { poll_id: editPoll.id, label: 'Option A', position: 0 },
    { poll_id: editPoll.id, label: 'Option B', position: 1 },
  ]).select();

  // Seed 2 respondents + 2 votes for Option A
  const editPhones = [`+15554${String(Date.now()).slice(-6)}`, `+15555${String(Date.now()).slice(-6)}`];
  for (let i = 0; i < 2; i++) {
    const { data: r } = await sb.from('respondents').insert({
      trip_id: editTrip.id,
      name: `Edit Person ${i + 1}`,
      phone: editPhones[i],
      session_token: `__${SUFFIX}__edit_r${i}`,
      rsvp: 'in',
    }).select().single();
    await sb.from('poll_responses').insert({
      poll_id: editPoll.id,
      respondent_id: r.id,
      option_id: editOpts[0].id,
    });
  }

  const { count: beforeCount } = await sb.from('poll_responses')
    .select('*', { count: 'exact', head: true })
    .eq('poll_id', editPoll.id);
  if (beforeCount === 2) ok(`2 poll_responses recorded before edit`);
  else bad(`expected 2 responses pre-edit, got ${beforeCount}`);

  // Simulate edit: delete the poll (cascade clears responses)
  await sb.from('polls').delete().eq('id', editPoll.id);

  const { count: afterCount } = await sb.from('poll_responses')
    .select('*', { count: 'exact', head: true })
    .eq('poll_id', editPoll.id);
  if (afterCount === 0) ok(`poll delete cascaded poll_responses to 0 (reset behavior)`);
  else bad(`expected 0 responses after cascade, got ${afterCount}`);

  // Broadcast row contract — direct insert mirrors what sms-broadcast writes
  // after auth. Edge-function invocation needs a real user JWT (the function
  // calls userClient.auth.getUser()), which a service-role CLI can't mint;
  // the meaningful integration assertion is the row shape itself.
  const { count: beforeBroadcasts } = await sb.from('thread_messages')
    .select('*', { count: 'exact', head: true })
    .eq('trip_session_id', ses.id)
    .eq('sender_role', 'planner_broadcast');
  const { data: bcRow, error: bcErr } = await sb.from('thread_messages').insert({
    thread_id: `broadcast_${ses.id}`,
    trip_session_id: ses.id,
    direction: 'outbound',
    sender_phone: null,
    sender_role: 'planner_broadcast',
    body: '__edit_followup_test__',
    message_sid: null,
  }).select().single();
  if (bcErr) {
    bad(`broadcast row insert: ${bcErr.message}`);
  } else {
    cleanup.push(['thread_messages', bcRow.id]);
    const { count: afterBroadcasts } = await sb.from('thread_messages')
      .select('*', { count: 'exact', head: true })
      .eq('trip_session_id', ses.id)
      .eq('sender_role', 'planner_broadcast');
    if ((afterBroadcasts ?? 0) === (beforeBroadcasts ?? 0) + 1)
      ok(`thread_messages accepted broadcast row (sender_role=planner_broadcast)`);
    else bad(`expected ${(beforeBroadcasts ?? 0) + 1} broadcasts, got ${afterBroadcasts}`);
  }
  // Note: "edit with no changes is a no-op" is a JS-state invariant in
  // app/(app)/trips/[id]/edit.tsx (initialSnapshot diff via arraysEqual /
  // customPollChanged). DB-level integration tests can't observe a JS
  // skipped-write — that case belongs in component-level tests.

  // Multi-poll position preservation: regression check for the
  // rebuildPoll/rebuildCustomPoll position-0 collision. Mirrors the
  // fixed flow — snapshot the original position, delete, re-insert at
  // the snapshotted position. Before the fix in edit.tsx, the rebuilt
  // poll always landed at position 0 and collided with siblings.
  const { data: posTrip } = await sb.from('trips').insert({
    created_by: profile.id,
    name: `__${SUFFIX}__pos_trip`,
    group_size_bucket: '5-8',
    share_token: `${SUFFIX}_pos`,
    status: 'active',
    book_by_date: bookByISO,
  }).select().single();
  cleanup.push(['trips', posTrip.id]);
  const { data: posDestPoll } = await sb.from('polls').insert({
    trip_id: posTrip.id, type: 'destination', title: 'Where?', status: 'live',
    allow_multi_select: true, position: 0,
  }).select().single();
  const { data: posDatesPoll } = await sb.from('polls').insert({
    trip_id: posTrip.id, type: 'dates', title: 'When?', status: 'live',
    allow_multi_select: true, position: 1,
  }).select().single();

  // Simulate rebuilding the dates poll: snapshot the position, delete, reinsert.
  const snapshotPosition = posDatesPoll.position;
  await sb.from('polls').delete().eq('id', posDatesPoll.id);
  const { data: posDatesRebuilt } = await sb.from('polls').insert({
    trip_id: posTrip.id, type: 'dates', title: 'When?', status: 'live',
    allow_multi_select: true, position: snapshotPosition,
  }).select().single();

  const { data: posPolls } = await sb.from('polls')
    .select('id, type, position').eq('trip_id', posTrip.id).order('position');
  const positions = (posPolls ?? []).map((p) => p.position);
  const distinct = new Set(positions).size === positions.length;
  if (distinct && posDatesRebuilt.position === 1 && posPolls.find((p) => p.type === 'destination').position === 0)
    ok(`multi-poll edit preserves positions [destination=0, dates=1] (no collision)`);
  else bad(`position collision after rebuild: ${JSON.stringify(posPolls)}`);

  // ─── 8. Traveler profile aggregation (DB contract) ─────────────────────
  section('Traveler profiles: round-trip + phone-join + empty state');
  // The `get_traveler_profiles_for_trip_session(uuid)` RPC is SECURITY
  // DEFINER but gates on auth.uid() (returns empty for service-role).
  // From a service-role CLI we can't exercise the RPC end-to-end — that
  // belongs in a user-JWT-authed test. What we *can* test here is the
  // table contract that the RPC reads from: traveler_profiles round-trip
  // and the phone-based join used at line 97 of migration 069.
  // The pure-JS `aggregateProfiles` (src/lib/aggregateProfiles.ts) is a
  // reducer over the RPC output and belongs in unit tests, not here.
  const profilePhone = `+1556${String(Date.now()).slice(-7)}`;
  const { data: profile1, error: profErr } = await sb.from('traveler_profiles').insert({
    phone: profilePhone,
    user_id: null,
    home_airport: 'JFK',
    travel_pref: 'with_group',
    flight_dealbreakers: ['red_eye', 'late_arr'],
    sleep_pref: 'own_room',
    lodging_pref: 'hotel',
    dietary_restrictions: ['vegetarian'],
    meal_pref: 'mixed',
    drinking_pref: 'casual',
    physical_limitations: [],
    trip_pace: 3,
    activity_types: ['food', 'culture'],
    budget_posture: 'middle',
    notes: '__test__',
  }).select().single();
  if (profErr) { bad(`profile insert: ${profErr.message}`); }
  else {
    cleanup.push(['traveler_profiles', profilePhone, 'phone']);
    if (profile1.activity_types.length === 2 && profile1.flight_dealbreakers.length === 2 && profile1.trip_pace === 3)
      ok(`traveler_profiles row round-trips arrays + scalars`);
    else bad(`profile shape wrong: ${JSON.stringify(profile1)}`);
  }

  // Phone-join contract: a participant with the same phone should join
  // 1:1 against traveler_profiles (mirrors migration 069 LEFT JOIN at line 97).
  // Reuse the section-2 session — a unique constraint enforces one session
  // per trip, so we attach two new participants there with profile/orphan phones.
  const { data: joinPart1, error: jp1Err } = await sb.from('trip_session_participants').insert({
    trip_session_id: ses.id,
    phone: profilePhone,
    display_name: 'Profile Person',
    status: 'active',
    is_attending: true,
    is_planner: false,
  }).select().single();
  if (jp1Err) bad(`profile participant insert: ${jp1Err.message}`);
  else cleanup.push(['trip_session_participants', joinPart1.id]);

  const orphanPhone = `+1557${String(Date.now()).slice(-7)}`;
  const { data: joinPart2, error: jp2Err } = await sb.from('trip_session_participants').insert({
    trip_session_id: ses.id,
    phone: orphanPhone,
    display_name: 'No Profile Person',
    status: 'active',
    is_attending: true,
    is_planner: false,
  }).select().single();
  if (jp2Err) bad(`orphan participant insert: ${jp2Err.message}`);
  else cleanup.push(['trip_session_participants', joinPart2.id]);

  // Mirror the migration-069 join: SELECT participants LEFT JOIN traveler_profiles ON phone.
  // PostgREST nested-select via FK isn't available here (no FK between
  // these tables — they share `phone` only), so we run two queries and
  // join in JS. Filter to just the two phones we just inserted to avoid
  // entanglement with section-2 participants.
  const { data: joinParts } = await sb.from('trip_session_participants')
    .select('id, phone, display_name')
    .eq('trip_session_id', ses.id)
    .in('phone', [profilePhone, orphanPhone]);
  const joinPhones = (joinParts ?? []).map((p) => p.phone);
  const { data: joinProfiles } = await sb.from('traveler_profiles')
    .select('phone, home_airport, activity_types')
    .in('phone', joinPhones);
  const profileByPhone = new Map((joinProfiles ?? []).map((p) => [p.phone, p]));
  const joined = (joinParts ?? []).map((p) => ({ ...p, profile: profileByPhone.get(p.phone) ?? null }));

  const matched = joined.find((j) => j.phone === profilePhone);
  const orphan  = joined.find((j) => j.phone === orphanPhone);
  if (matched && matched.profile && matched.profile.home_airport === 'JFK')
    ok(`phone-join: matched participant got home_airport=JFK`);
  else bad(`phone-join: matched profile missing or wrong: ${JSON.stringify(matched)}`);
  if (orphan && orphan.profile === null)
    ok(`phone-join: participant without traveler_profile yields profile=null (empty state)`);
  else bad(`phone-join: orphan participant should have profile=null, got ${JSON.stringify(orphan?.profile)}`);

  // ─── 9. Per-day dates poll → heatmap RPC shape ─────────────────────────
  section('Per-day dates poll: aggregate_results_by_share_token RPC');
  // The /results/[token] page and DateHeatmap consume the public RPC
  // get_aggregate_results_by_share_token (migration 051). For per-day
  // dates polls, each calendar day becomes one poll_option row whose
  // `label` parses via parseDateRangeLabel ("Jun 17" → start === end).
  // Verify the RPC returns the expected shape so the heatmap can render.
  const datesShareToken = `${SUFFIX}_dates`;
  const { data: datesTrip, error: datesTripErr } = await sb.from('trips').insert({
    created_by: profile.id,
    name: `__${SUFFIX}__dates_trip`,
    group_size_bucket: '5-8',
    share_token: datesShareToken,
    status: 'active',
    book_by_date: bookByISO,
  }).select().single();
  if (datesTripErr) { bad(`dates-trip insert: ${datesTripErr.message}`); await runCleanup(); return; }
  cleanup.push(['trips', datesTrip.id]);

  const { data: datesPoll } = await sb.from('polls').insert({
    trip_id: datesTrip.id,
    type: 'dates',
    title: 'When are you free?',
    status: 'live',
    allow_multi_select: true,
    position: 0,
  }).select().single();
  const dayLabels = ['Jun 17', 'Jun 18', 'Jun 19'];
  const { data: dayOpts } = await sb.from('poll_options').insert(
    dayLabels.map((label, i) => ({ poll_id: datesPoll.id, label, position: i })),
  ).select();

  // Seed votes: Jun 17 → 2, Jun 18 → 1, Jun 19 → 0
  const datesPhones = [`+1558${String(Date.now()).slice(-7)}`, `+1559${String(Date.now()).slice(-7)}`];
  const datesRespondents = [];
  for (let i = 0; i < 2; i++) {
    const { data: r } = await sb.from('respondents').insert({
      trip_id: datesTrip.id,
      name: `Dates Person ${i + 1}`,
      phone: datesPhones[i],
      session_token: `__${SUFFIX}__dates_r${i}`,
      rsvp: 'in',
    }).select().single();
    datesRespondents.push(r);
  }
  await sb.from('poll_responses').insert([
    { poll_id: datesPoll.id, respondent_id: datesRespondents[0].id, option_id: dayOpts[0].id }, // r0 → Jun 17
    { poll_id: datesPoll.id, respondent_id: datesRespondents[0].id, option_id: dayOpts[1].id }, // r0 → Jun 18
    { poll_id: datesPoll.id, respondent_id: datesRespondents[1].id, option_id: dayOpts[0].id }, // r1 → Jun 17
  ]);

  const { data: rpcResult, error: rpcErr } = await sb.rpc(
    'get_aggregate_results_by_share_token',
    { p_token: datesShareToken },
  );
  if (rpcErr) {
    bad(`RPC failed: ${rpcErr.message}`);
  } else if (!rpcResult || !rpcResult.ok) {
    bad(`RPC returned not-ok: ${JSON.stringify(rpcResult)}`);
  } else {
    if (rpcResult.trip?.id === datesTrip.id) ok(`RPC ok=true with trip.id matching share_token`);
    else bad(`RPC trip wrong: ${JSON.stringify(rpcResult.trip)}`);

    const datesEntry = (rpcResult.polls ?? []).find((p) => p.id === datesPoll.id);
    if (datesEntry && datesEntry.type === 'dates' && datesEntry.options.length === 3)
      ok(`polls[] contains dates poll with 3 per-day options`);
    else bad(`dates poll missing or wrong: ${JSON.stringify(datesEntry)}`);

    if (datesEntry) {
      const sortedByPos = [...datesEntry.options].sort((a, b) => a.position - b.position);
      const labels = sortedByPos.map((o) => o.label);
      const votes  = sortedByPos.map((o) => o.votes);
      if (labels.join(',') === 'Jun 17,Jun 18,Jun 19' && votes.join(',') === '2,1,0')
        ok(`options sorted by position with correct vote counts {Jun 17:2, Jun 18:1, Jun 19:0}`);
      else bad(`option order/votes wrong: labels=${labels} votes=${votes}`);
    }

    if (rpcResult.total_responses === 2) ok(`total_responses = 2 distinct respondents`);
    else bad(`expected total_responses=2, got ${rpcResult.total_responses}`);
  }

  // ─── 10. Cleanup ────────────────────────────────────────────────────────
  await runCleanup();
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log(`${'═'.repeat(60)}\n`);
  process.exit(failed > 0 ? 1 : 0);
}

async function runCleanup() {
  // Cleanup in reverse insert order. Child rows cascade via FKs.
  // Tuples are [table, value] (column defaults to 'id') or
  // [table, value, column] for tables keyed on something other than id.
  for (const entry of cleanup.reverse()) {
    const [table, value, column = 'id'] = entry;
    const { error } = await sb.from(table).delete().eq(column, value);
    if (error) console.warn(`cleanup ${table}/${value} (${column}) failed:`, error.message);
  }
  console.log(`\nCleanup: ${cleanup.length} rows removed`);
}

main().catch(async (err) => {
  console.error('Fatal:', err);
  await runCleanup();
  process.exit(1);
});
