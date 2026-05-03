/**
 * Deno tests for cadence helpers — `filterCadenceForJoiner`.
 *
 * Trip-anchored cadence: every participant shares the same launch
 * timestamp (session.created_at) so d1/d3/heartbeat/rd_minus_2/rd_minus_1
 * line up across the group. The filter prunes items that fall before a
 * given participant's join time so a late-add member doesn't receive
 * stale "initial" / early-window nudges.
 *
 * Run: deno test supabase/functions/_sms-shared/cadence_test.ts
 */

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  computeCadence,
  filterCadenceForJoiner,
  LATE_JOINER_GRACE_MS,
  type CadenceItem,
} from './cadence.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

function iso(d: Date): string { return d.toISOString(); }

function makeCadence(launchAt: Date, dueDays = 30): CadenceItem[] {
  const due = new Date(launchAt.getTime() + dueDays * DAY_MS);
  return computeCadence({ launchAt, responsesDueDate: due });
}

// ─── filterCadenceForJoiner ──────────────────────────────────────────────

Deno.test('filterCadenceForJoiner — fresh joiner keeps every item', () => {
  const launch = new Date('2026-05-01T16:00:00Z');
  const items = makeCadence(launch);
  // Original-group member joined at the trip's launch instant.
  const filtered = filterCadenceForJoiner(items, launch);
  assertEquals(filtered.length, items.length);
});

Deno.test('filterCadenceForJoiner — joining within the 12h grace window keeps initial', () => {
  const launch = new Date('2026-05-01T16:00:00Z');
  const items = makeCadence(launch);
  // Joined 6 hours after launch — still inside the grace window, so the
  // 'initial' (anchored at launch) survives the filter.
  const joinedAt = new Date(launch.getTime() + 6 * 60 * 60 * 1000);
  const filtered = filterCadenceForJoiner(items, joinedAt);
  assertEquals(filtered.length, items.length);
  assertEquals(filtered[0].kind, 'initial');
});

Deno.test('filterCadenceForJoiner — late joiner past day 2 drops initial and d1', () => {
  const launch = new Date('2026-05-01T16:00:00Z');
  const items = makeCadence(launch);
  // Joined 2 days after launch (well past initial @ T+0 and d1 @ T+1).
  const joinedAt = new Date(launch.getTime() + 2 * DAY_MS);
  const filtered = filterCadenceForJoiner(items, joinedAt);
  // Original cadence items: initial, d1, d3, rd_minus_2, rd_minus_1
  // (heartbeats only seed for very long windows; due in 30d here so
  // there'd be ~1 heartbeat, but we don't assert exact count — we only
  // check the past-window items got pruned.)
  const kinds = filtered.map((it) => it.kind);
  assertEquals(kinds.includes('initial'), false);
  assertEquals(kinds.includes('d1'), false);
  assertEquals(kinds.includes('d3'), true);
  assertEquals(kinds.includes('rd_minus_2'), true);
  assertEquals(kinds.includes('rd_minus_1'), true);
});

Deno.test('filterCadenceForJoiner — joining after responses_due drops everything', () => {
  const launch = new Date('2026-05-01T16:00:00Z');
  const items = makeCadence(launch, 7); // 7-day window
  // Joined 8 days after launch — past every cadence item.
  const joinedAt = new Date(launch.getTime() + 8 * DAY_MS);
  const filtered = filterCadenceForJoiner(items, joinedAt);
  assertEquals(filtered.length, 0);
});

Deno.test('filterCadenceForJoiner — null joinedAt leaves items untouched', () => {
  const launch = new Date('2026-05-01T16:00:00Z');
  const items = makeCadence(launch);
  assertEquals(filterCadenceForJoiner(items, null), items);
  assertEquals(filterCadenceForJoiner(items, undefined), items);
});

Deno.test('filterCadenceForJoiner — invalid joinedAt string leaves items untouched', () => {
  const launch = new Date('2026-05-01T16:00:00Z');
  const items = makeCadence(launch);
  // Bad input shouldn't crash — defensive against ill-formed DB rows.
  assertEquals(filterCadenceForJoiner(items, 'not-a-date'), items);
});

Deno.test('filterCadenceForJoiner — accepts ISO string for joinedAt', () => {
  const launch = new Date('2026-05-01T16:00:00Z');
  const items = makeCadence(launch);
  const joinedAt = new Date(launch.getTime() + 2 * DAY_MS);
  // ISO string and Date should produce identical filtering.
  assertEquals(
    filterCadenceForJoiner(items, iso(joinedAt)),
    filterCadenceForJoiner(items, joinedAt),
  );
});

Deno.test('filterCadenceForJoiner — custom grace window narrows the keep set', () => {
  const launch = new Date('2026-05-01T16:00:00Z');
  const items = makeCadence(launch);
  // Joined 4 hours after launch. Default 12h grace would keep `initial`;
  // with a 1h grace it should drop.
  const joinedAt = new Date(launch.getTime() + 4 * 60 * 60 * 1000);
  const defaultFiltered = filterCadenceForJoiner(items, joinedAt);
  const tightFiltered = filterCadenceForJoiner(items, joinedAt, 60 * 60 * 1000);
  assertEquals(defaultFiltered[0].kind, 'initial');
  assertEquals(tightFiltered[0].kind === 'initial', false);
});

Deno.test('filterCadenceForJoiner — LATE_JOINER_GRACE_MS exported as 12h', () => {
  // The exported constant pins the default behavior — guard against
  // accidental drift if someone tweaks the literal in cadence.ts.
  assertEquals(LATE_JOINER_GRACE_MS, 12 * 60 * 60 * 1000);
});
