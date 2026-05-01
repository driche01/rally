/**
 * Deno tests for buildRedirectBody (Phase 1.3 + Phase 15).
 *
 * Rally no longer relays member→planner messages. The redirect copy
 * tells the sender to text the planner directly and re-shares their
 * survey link when we know who they are.
 *
 * Run: deno test supabase/functions/_sms-shared/planner-notify_test.ts
 */

import { assert, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { buildRedirectBody, type PlannerInboundMatch } from './planner-notify.ts';

const KNOWN_MATCH: PlannerInboundMatch = {
  trip_session_id: 'sess-1',
  trip_id: 'trip-1',
  participant_id: 'p-1',
  participant_name: 'Alex Carter',
  planner_user_id: 'u-1',
  planner_name: 'Maya Singh',
};

Deno.test('buildRedirectBody — known sender, with survey URL', () => {
  const body = buildRedirectBody([KNOWN_MATCH], 'https://rallysurveys.netlify.app/respond/abc');
  assertStringIncludes(body, 'Maya');
  assertStringIncludes(body, "can't");
  assertStringIncludes(body, 'rallysurveys.netlify.app/respond/abc');
});

Deno.test('buildRedirectBody — known sender, no URL', () => {
  const body = buildRedirectBody([KNOWN_MATCH], null);
  assertStringIncludes(body, 'Maya');
  assertStringIncludes(body, "can't");
  assert(!body.includes('http'), 'no URL when none provided');
});

Deno.test('buildRedirectBody — known sender, default URL arg', () => {
  // Calling without the second arg should still work (default = null).
  const body = buildRedirectBody([KNOWN_MATCH]);
  assertStringIncludes(body, 'Maya');
});

Deno.test('buildRedirectBody — unknown sender uses legacy redirect', () => {
  const body = buildRedirectBody([], null);
  assertStringIncludes(body, "I'm Rally");
  assertStringIncludes(body, 'STOP');
  assert(!body.includes('Maya'));
});

Deno.test('buildRedirectBody — match with no planner_name uses legacy', () => {
  const orphan: PlannerInboundMatch = { ...KNOWN_MATCH, planner_name: null };
  const body = buildRedirectBody([orphan], null);
  assertStringIncludes(body, "I'm Rally");
});

Deno.test('buildRedirectBody — picks first match with a known planner', () => {
  const noName: PlannerInboundMatch = { ...KNOWN_MATCH, planner_name: null, planner_user_id: 'u-2' };
  const body = buildRedirectBody([noName, KNOWN_MATCH], null);
  assertStringIncludes(body, 'Maya');
});

Deno.test('buildRedirectBody — first-name only (drops surname)', () => {
  const body = buildRedirectBody([{ ...KNOWN_MATCH, planner_name: 'Maya Singh-Brown' }], null);
  assertStringIncludes(body, 'Maya');
  assert(!body.includes('Singh-Brown'), 'should not include surname');
});
