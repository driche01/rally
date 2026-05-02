/**
 * Deno tests for the nudge scheduler's pure skip decisions.
 *
 * Run: deno test supabase/functions/_sms-shared/skip-rules_test.ts
 */

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  isTripStartedAsOf,
  isTripFullyLocked,
  SKIP_REASON_TRIP_STARTED,
  SKIP_REASON_TRIP_LOCKED,
} from './skip-rules.ts';

// ─── isTripStartedAsOf ────────────────────────────────────────────────────

Deno.test('isTripStartedAsOf — null start_date never suppresses', () => {
  assertEquals(isTripStartedAsOf(null, '2026-05-02'), false);
  assertEquals(isTripStartedAsOf(undefined, '2026-05-02'), false);
});

Deno.test('isTripStartedAsOf — future start_date is not yet started', () => {
  assertEquals(isTripStartedAsOf('2026-06-01', '2026-05-02'), false);
});

Deno.test('isTripStartedAsOf — start_date today counts as started', () => {
  // The user's bug report screenshot: trip starts May 2, scheduler ticks
  // on May 2 — the nudge queued for May 3 must not fire.
  assertEquals(isTripStartedAsOf('2026-05-02', '2026-05-02'), true);
});

Deno.test('isTripStartedAsOf — past start_date counts as started', () => {
  assertEquals(isTripStartedAsOf('2026-04-15', '2026-05-02'), true);
});

Deno.test('isTripStartedAsOf — empty string short-circuits to false', () => {
  // Defensive: an empty start_date arriving from the DB shouldn't
  // accidentally compare-true against any todayIso.
  assertEquals(isTripStartedAsOf('', '2026-05-02'), false);
});

// ─── isTripFullyLocked ────────────────────────────────────────────────────

Deno.test('isTripFullyLocked — zero polls is NOT locked', () => {
  // A brand-new trip with no polls yet has nothing to lock; pending
  // nudges (if any) are about RSVP/preferences, not poll completion.
  assertEquals(isTripFullyLocked(0, 0), false);
});

Deno.test('isTripFullyLocked — some polls still undecided is NOT locked', () => {
  assertEquals(isTripFullyLocked(4, 1), false);
  assertEquals(isTripFullyLocked(4, 4), false);
});

Deno.test('isTripFullyLocked — every poll decided IS locked', () => {
  assertEquals(isTripFullyLocked(4, 0), true);
  assertEquals(isTripFullyLocked(1, 0), true);
});

// ─── Skip-reason constants ────────────────────────────────────────────────

Deno.test('skip-reason constants are stable strings', () => {
  // Pin the exact strings — migration 105 reads them back from
  // nudge_sends.skip_reason in the unlock trigger, and the dashboard
  // would also surface them if we ever expose skip reasons in the UI.
  assertEquals(SKIP_REASON_TRIP_STARTED, 'trip_started');
  assertEquals(SKIP_REASON_TRIP_LOCKED, 'trip_locked');
});
