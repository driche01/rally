#!/usr/bin/env node
/**
 * Live state tail for the active e2e test trip.
 *
 * Reads trip_id from .test-trip.json (written by launch-test-trip.js) or
 * from --trip-id arg. Polls every 5s, prints what changed since last tick.
 *
 *   node scripts/watch-trip.js                  # use .test-trip.json
 *   node scripts/watch-trip.js --trip-id <uuid> # explicit trip
 *   node scripts/watch-trip.js --interval 10    # poll every 10s
 *
 * Ctrl-C to stop.
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
  const out = { tripId: null, interval: 5 };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--trip-id') out.tripId = args[++i];
    else if (args[i] === '--interval') out.interval = parseInt(args[++i], 10) || 5;
  }
  return out;
}

function resolveTripId(arg) {
  if (arg) return arg;
  const stateFile = path.join(__dirname, '..', '.test-trip.json');
  if (!fs.existsSync(stateFile)) {
    console.error('No trip_id and no .test-trip.json — run launch-test-trip.js first or pass --trip-id.');
    process.exit(2);
  }
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
  return state.trip_id;
}

function rel(iso) {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) {
    const future = -ms;
    if (future < 60_000) return `in ${Math.round(future / 1000)}s`;
    if (future < 3600_000) return `in ${Math.round(future / 60_000)}m`;
    return `in ${Math.round(future / 3600_000)}h`;
  }
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}

function clear() { process.stdout.write('\x1b[2J\x1b[H'); }
function color(s, code) { return `\x1b[${code}m${s}\x1b[0m`; }
const bold   = (s) => color(s, '1');
const dim    = (s) => color(s, '2');
const green  = (s) => color(s, '32');
const yellow = (s) => color(s, '33');
const red    = (s) => color(s, '31');
const cyan   = (s) => color(s, '36');

function statusColor(status) {
  if (status === 'sent') return green('●');
  if (status === 'pending') return yellow('●');
  if (status === 'skipped') return dim('○');
  return '●';
}

async function snapshot(tripId) {
  const [tripR, sessR] = await Promise.all([
    sb.from('trips').select('id, name, destination, book_by_date, responses_due_date, status, share_token').eq('id', tripId).maybeSingle(),
    sb.from('trip_sessions').select('id, last_synth_milestone, last_synth_sent_at').eq('trip_id', tripId).in('status', ['ACTIVE', 'PAUSED']).order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (!tripR.data) {
    console.error(red(`Trip ${tripId} not found.`));
    process.exit(1);
  }
  const trip = tripR.data;
  const session = sessR.data;
  const sessionId = session?.id;

  const [partR, nudgeR, recR, threadR, inboxR] = await Promise.all([
    sessionId
      ? sb.from('trip_session_participants')
          .select('id, phone, display_name, status, is_attending, is_planner, last_activity_at, joined_at')
          .eq('trip_session_id', sessionId)
          .order('joined_at', { ascending: true })
      : Promise.resolve({ data: [] }),
    sessionId
      ? sb.from('nudge_sends')
          .select('id, participant_id, nudge_type, scheduled_for, sent_at, skipped_at, skip_reason')
          .eq('trip_session_id', sessionId)
          .order('scheduled_for', { ascending: true })
      : Promise.resolve({ data: [] }),
    sb.from('poll_recommendations')
      .select('id, poll_id, recommendation_text, status, locked_value, planner_action_at, confidence, created_at')
      .eq('trip_id', tripId)
      .order('created_at', { ascending: false }),
    sessionId
      ? sb.from('thread_messages')
          .select('direction, sender_role, sender_phone, body, created_at')
          .eq('trip_session_id', sessionId)
          .order('created_at', { ascending: false })
          .limit(8)
      : Promise.resolve({ data: [] }),
    sessionId
      ? sb.from('thread_messages')
          .select('id, sender_phone, body, created_at, planner_acknowledged_at')
          .eq('trip_session_id', sessionId)
          .eq('direction', 'inbound')
          .eq('needs_planner_attention', true)
          .order('created_at', { ascending: false })
          .limit(5)
      : Promise.resolve({ data: [] }),
  ]);

  const respondentR = await sb.from('respondents')
    .select('id, phone, name, rsvp, preferences, created_at')
    .eq('trip_id', tripId);

  return {
    trip, session, sessionId,
    participants: partR.data ?? [],
    nudges: nudgeR.data ?? [],
    recommendations: recR.data ?? [],
    thread: threadR.data ?? [],
    inbox: inboxR.data ?? [],
    respondents: respondentR.data ?? [],
  };
}

function render(s) {
  const { trip, session, participants, nudges, recommendations, thread, inbox, respondents } = s;

  clear();
  console.log(bold(`◆ ${trip.name}`));
  console.log(dim(`  ${trip.id} · share_token=${trip.share_token}`));
  console.log(`  destination: ${trip.destination ?? '—'} · status: ${trip.status}`);
  console.log(`  book_by: ${trip.book_by_date ?? '—'} · responses_due: ${trip.responses_due_date ?? '—'} (${rel(trip.responses_due_date ? trip.responses_due_date + 'T16:00:00Z' : null)})`);
  if (session?.last_synth_milestone) {
    console.log(`  synth milestone: ${session.last_synth_milestone} · ${rel(session.last_synth_sent_at)}`);
  }

  console.log('');
  console.log(bold(`PARTICIPANTS (${participants.length})`));
  const respByPhone = new Map();
  for (const r of respondents) respByPhone.set(r.phone, r);
  for (const p of participants) {
    const r = respByPhone.get(p.phone);
    let respondedTag = dim('not responded');
    if (r?.rsvp === 'out') respondedTag = red('declined');
    else if (r?.rsvp === 'in' && r?.preferences) respondedTag = green('responded');
    else if (r?.rsvp) respondedTag = yellow('partial');
    const planner = p.is_planner ? cyan('[planner] ') : '';
    const lastAct = p.last_activity_at ? `last_activity: ${rel(p.last_activity_at)}` : `joined: ${rel(p.joined_at)}`;
    console.log(`  ${planner}${p.display_name ?? '?'} · ${p.phone} · ${respondedTag} · ${dim(lastAct)}`);
  }

  console.log('');
  const pending = nudges.filter((n) => !n.sent_at && !n.skipped_at);
  const sent = nudges.filter((n) => n.sent_at);
  const skipped = nudges.filter((n) => n.skipped_at);
  console.log(bold(`NUDGES — ${green(`${sent.length} sent`)} · ${yellow(`${pending.length} pending`)} · ${dim(`${skipped.length} skipped`)}`));
  const mostRecent = [...nudges].sort((a, b) => {
    const ta = new Date(a.sent_at ?? a.skipped_at ?? a.scheduled_for).getTime();
    const tb = new Date(b.sent_at ?? b.skipped_at ?? b.scheduled_for).getTime();
    return tb - ta;
  }).slice(0, 6);
  for (const n of mostRecent) {
    const dot = n.sent_at ? statusColor('sent') : n.skipped_at ? statusColor('skipped') : statusColor('pending');
    const stamp = n.sent_at ? `sent ${rel(n.sent_at)}` : n.skipped_at ? `skipped (${n.skip_reason}) ${rel(n.skipped_at)}` : `due ${rel(n.scheduled_for)}`;
    const part = participants.find((p) => p.id === n.participant_id);
    const who = part?.display_name ?? part?.phone ?? '—';
    console.log(`  ${dot} ${n.nudge_type.padEnd(11)} → ${who.padEnd(20)} ${dim(stamp)}`);
  }

  console.log('');
  console.log(bold(`RECOMMENDATIONS (${recommendations.length})`));
  for (const r of recommendations.slice(0, 4)) {
    const tag =
      r.status === 'pending'  ? yellow('pending')
      : r.status === 'approved' ? green('approved')
      : r.status === 'edited'   ? green('edited')
      : r.status === 'held'     ? cyan('held')
      : dim(r.status);
    console.log(`  ${tag} · ${r.recommendation_text}`);
    if (r.locked_value) console.log(`    locked: "${r.locked_value}" · ${rel(r.planner_action_at)}`);
  }

  console.log('');
  console.log(bold(`INBOX (${inbox.filter((i) => !i.planner_acknowledged_at).length} unread)`));
  for (const m of inbox.slice(0, 3)) {
    const tag = m.planner_acknowledged_at ? dim('seen') : yellow('new');
    console.log(`  ${tag} ${m.sender_phone} · ${rel(m.created_at)}`);
    console.log(`    "${(m.body ?? '').slice(0, 80)}"`);
  }

  console.log('');
  console.log(bold(`THREAD (last 6)`));
  for (const t of thread.slice(0, 6)) {
    const arrow = t.direction === 'outbound' ? '←' : '→';
    const role = (t.sender_role ?? '').padEnd(20);
    const body = (t.body ?? '').replace(/\s+/g, ' ').slice(0, 70);
    console.log(`  ${dim(rel(t.created_at).padStart(8))} ${arrow} ${dim(role)} ${body}`);
  }

  console.log(dim(`\n(refreshing — Ctrl-C to stop)`));
}

async function main() {
  const args = parseArgs();
  const tripId = resolveTripId(args.tripId);

  while (true) {
    try {
      const s = await snapshot(tripId);
      render(s);
    } catch (err) {
      console.error(`snapshot failed: ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, args.interval * 1000));
  }
}

main();
