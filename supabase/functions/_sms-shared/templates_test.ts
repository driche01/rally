/**
 * Deno tests for outbound SMS templates.
 *
 * Run: deno test supabase/functions/_sms-shared/templates_test.ts
 */

import { assertEquals, assertStringIncludes, assert } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  initialOutreachSms,
  nudgeBody,
  socialProofWithNames,
  socialProofCountOnly,
  synthHalfSms,
  synthPreDueSms,
  synthFullSms,
  type NudgeBodyOpts,
  type SynthBodyOpts,
} from './templates.ts';

const SURVEY = 'https://rallysurveys.netlify.app/respond/abc';
const RESULTS = 'https://rallysurveys.netlify.app/results/abc';

function nudgeOpts(overrides: Partial<NudgeBodyOpts> = {}): NudgeBodyOpts {
  return {
    recipientName: 'Alex Carter',
    plannerName: 'Maya Singh',
    destination: 'Cancun',
    surveyUrl: SURVEY,
    responsesDueDate: '2026-06-12',
    ...overrides,
  };
}

function synthOpts(overrides: Partial<SynthBodyOpts> = {}): SynthBodyOpts {
  return {
    plannerName: 'Maya Singh',
    destination: 'Cancun',
    resultsUrl: RESULTS,
    respondedCount: 4,
    totalCount: 7,
    ...overrides,
  };
}

// ─── socialProofWithNames ──────────────────────────────────────────────────

Deno.test('socialProofWithNames — empty list returns empty', () => {
  assertEquals(socialProofWithNames([], 0, 7), '');
});

Deno.test('socialProofWithNames — zero respondedCount returns empty', () => {
  assertEquals(socialProofWithNames(['Alex'], 0, 7), '');
});

Deno.test('socialProofWithNames — zero totalCount returns empty', () => {
  assertEquals(socialProofWithNames(['Alex'], 1, 0), '');
});

Deno.test('socialProofWithNames — 1 responder', () => {
  assertEquals(socialProofWithNames(['Alex'], 1, 7), 'Alex has answered, 6 left.');
});

Deno.test('socialProofWithNames — 2 responders', () => {
  assertEquals(socialProofWithNames(['Alex', 'Sam'], 2, 7), 'Alex and Sam have answered, 5 left.');
});

Deno.test('socialProofWithNames — 3 responders, no overflow', () => {
  assertEquals(
    socialProofWithNames(['Alex', 'Jordan', 'Sam'], 3, 7),
    'Alex, Jordan, and Sam have answered, 4 left.',
  );
});

Deno.test('socialProofWithNames — 4 responders, 1 overflow', () => {
  assertEquals(
    socialProofWithNames(['Alex', 'Jordan', 'Pat', 'Sam'], 4, 8),
    'Alex, Jordan, Pat, and 1 other have answered, 4 left.',
  );
});

Deno.test('socialProofWithNames — 5 responders, 2 overflow', () => {
  assertEquals(
    socialProofWithNames(['Alex', 'Jordan', 'Pat', 'Riley', 'Sam'], 5, 8),
    'Alex, Jordan, Pat, and 2 others have answered, 3 left.',
  );
});

Deno.test('socialProofWithNames — everyone in drops the "X left" tail', () => {
  assertEquals(
    socialProofWithNames(['Alex', 'Sam', 'Jordan'], 3, 3),
    'Alex, Sam, and Jordan have answered.',
  );
});

// ─── socialProofCountOnly ──────────────────────────────────────────────────

Deno.test('socialProofCountOnly — zero total returns empty', () => {
  assertEquals(socialProofCountOnly(0, 0), '');
});

Deno.test('socialProofCountOnly — everyone in returns empty (no urgency)', () => {
  assertEquals(socialProofCountOnly(7, 7), '');
});

Deno.test('socialProofCountOnly — partial response', () => {
  assertEquals(socialProofCountOnly(3, 7), '3 of 7 in, 4 still left.');
});

Deno.test('socialProofCountOnly — only 1 left', () => {
  assertEquals(socialProofCountOnly(6, 7), '6 of 7 in, 1 still left.');
});

// ─── nudgeBody — Phase 5 voice ─────────────────────────────────────────────

Deno.test('nudgeBody d1 — your trip framing + social proof', () => {
  const body = nudgeBody('d1', nudgeOpts({
    responderNames: ['Alex', 'Jordan', 'Sam'],
    respondedCount: 3,
    totalCount: 7,
  }));
  assertStringIncludes(body, 'your Cancun trip survey is open');
  assertStringIncludes(body, 'Alex, Jordan, and Sam have answered, 4 left.');
  assertStringIncludes(body, SURVEY);
  // Voice check: no "Maya's trip" framing.
  assert(!body.includes("Maya's trip"), 'd1 should not say Maya\'s trip');
});

Deno.test('nudgeBody d3 — your trip framing', () => {
  const body = nudgeBody('d3', nudgeOpts({
    responderNames: ['Alex'],
    respondedCount: 1,
    totalCount: 7,
  }));
  assertStringIncludes(body, 'Your Cancun trip is shaping up');
  assertStringIncludes(body, 'Alex has answered, 6 left.');
});

Deno.test('nudgeBody heartbeat — your trip framing', () => {
  const body = nudgeBody('heartbeat', nudgeOpts({
    responderNames: ['Alex', 'Sam'],
    respondedCount: 2,
    totalCount: 5,
  }));
  assertStringIncludes(body, 'Your Cancun trip survey is still hanging out');
  assertStringIncludes(body, 'Alex and Sam have answered, 3 left.');
});

Deno.test('nudgeBody rd_minus_2 — count-only proof, no names', () => {
  const body = nudgeBody('rd_minus_2', nudgeOpts({
    responderNames: ['Alex', 'Sam', 'Jordan'],
    respondedCount: 3,
    totalCount: 7,
  }));
  assertStringIncludes(body, '2 days to weigh in on your Cancun trip');
  assertStringIncludes(body, '3 of 7 in, 4 still left.');
  assert(!body.includes('Alex'), 'rd_minus_2 should not include names');
  assert(!body.includes('Jordan'), 'rd_minus_2 should not include names');
});

Deno.test('nudgeBody rd_minus_1 — last call urgency', () => {
  const body = nudgeBody('rd_minus_1', nudgeOpts({
    responderNames: ['Alex'],
    respondedCount: 1,
    totalCount: 5,
  }));
  assertStringIncludes(body, 'Last call');
  assertStringIncludes(body, 'your Cancun trip locks in tomorrow');
  assertStringIncludes(body, '1 of 5 in, 4 still left.');
});

Deno.test('nudgeBody — drops social proof when no responders', () => {
  const body = nudgeBody('d1', nudgeOpts({
    responderNames: [],
    respondedCount: 0,
    totalCount: 7,
  }));
  assertStringIncludes(body, 'your Cancun trip survey is open');
  // No "Alex" text and no "left" should appear.
  assert(!body.includes('have answered'));
  assert(!body.match(/\d+ left/));
});

Deno.test('nudgeBody — falls back to "trip" when destination missing', () => {
  const body = nudgeBody('d1', nudgeOpts({ destination: null, responderNames: [], respondedCount: 0, totalCount: 0 }));
  assertStringIncludes(body, 'your trip survey is open');
  assert(!body.includes('null'));
});

// ─── initialOutreachSms — Phase 5 ──────────────────────────────────────────

Deno.test('initialOutreachSms — playful tone, planner-led intro', () => {
  const body = initialOutreachSms(nudgeOpts());
  assertStringIncludes(body, 'Hey Alex');
  assertStringIncludes(body, "Maya's planning a Cancun trip");
  assertStringIncludes(body, 'wants your picks');
  assertStringIncludes(body, SURVEY);
});

Deno.test('initialOutreachSms — gracefully handles missing recipient name', () => {
  const body = initialOutreachSms(nudgeOpts({ recipientName: null }));
  assert(!body.includes('Hey  '), 'no orphan double-space when name missing');
  assertStringIncludes(body, "Maya's planning a Cancun trip");
});

// ─── synthesis bodies — Phase 3 ────────────────────────────────────────────

Deno.test('synthHalfSms — your trip framing', () => {
  const body = synthHalfSms(synthOpts({
    leaders: ['Cancun', 'Jun 12-19'],
  }));
  assertStringIncludes(body, '4 of 7 in on your Cancun trip');
  assertStringIncludes(body, 'Leading: Cancun, Jun 12-19.');
  assertStringIncludes(body, RESULTS);
});

Deno.test('synthPreDueSms — your trip framing + missing-count copy', () => {
  const body = synthPreDueSms(synthOpts({
    respondedCount: 5,
    totalCount: 7,
    leaders: ['Cancun'],
  }));
  assertStringIncludes(body, 'your Cancun trip locks in tomorrow');
  assertStringIncludes(body, "2 people haven't responded yet.");
});

Deno.test('synthPreDueSms — singular "person hasn\'t" when 1 missing', () => {
  const body = synthPreDueSms(synthOpts({ respondedCount: 6, totalCount: 7 }));
  assertStringIncludes(body, "1 person hasn't responded yet.");
});

Deno.test('synthFullSms — 4-leader format, all categories', () => {
  const body = synthFullSms(synthOpts({
    respondedCount: 7,
    totalCount: 7,
    fullLeaders: {
      destination: 'Cancun',
      dates: 'Jun 12-19',
      duration: '7 nights',
      budget: '$1,500/person',
    },
  }));
  assertStringIncludes(body, "Everyone's in on your Cancun trip");
  assertStringIncludes(body, '7 of 7');
  assertStringIncludes(body, 'Maya will lock in plans next');
  assertStringIncludes(body, 'Leading: Cancun · Jun 12-19 · 7 nights · $1,500/person.');
});

Deno.test('synthFullSms — handles missing leader categories', () => {
  const body = synthFullSms(synthOpts({
    respondedCount: 4,
    totalCount: 4,
    fullLeaders: { destination: 'Cancun', dates: 'Jun 12-19' },
  }));
  assertStringIncludes(body, 'Leading: Cancun · Jun 12-19.');
  assert(!body.includes(' · null'));
  assert(!body.includes(' · undefined'));
});

Deno.test('synthFullSms — drops Leading clause when no fullLeaders', () => {
  const body = synthFullSms(synthOpts({
    respondedCount: 4,
    totalCount: 4,
  }));
  assert(!body.includes('Leading:'));
});
