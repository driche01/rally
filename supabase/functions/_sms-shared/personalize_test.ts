/**
 * Deno tests for personalizeBody.
 *
 * Run: deno test supabase/functions/_sms-shared/personalize_test.ts
 */

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { personalizeBody } from './personalize.ts';

// ─── recipient name ──────────────────────────────────────────────────────

Deno.test('personalizeBody — [Name] resolves to first name', () => {
  assertEquals(
    personalizeBody('Hey [Name] — quick survey', { recipientName: 'Alex Carter' }),
    'Hey Alex — quick survey',
  );
});

Deno.test('personalizeBody — [Their name] (legacy) resolves to first name', () => {
  assertEquals(
    personalizeBody('Hey [Their name] — quick survey', { recipientName: 'Alex Carter' }),
    'Hey Alex — quick survey',
  );
});

Deno.test('personalizeBody — recipient placeholder is case-insensitive', () => {
  assertEquals(
    personalizeBody('Hey [name] [NAME] [Their Name]', { recipientName: 'Alex' }),
    'Hey Alex Alex Alex',
  );
});

Deno.test('personalizeBody — missing recipient falls back to "there"', () => {
  assertEquals(
    personalizeBody('Hey [Name] —', { recipientName: null }),
    'Hey there —',
  );
});

// ─── planner ──────────────────────────────────────────────────────────────

Deno.test('personalizeBody — [Planner] resolves to first name', () => {
  assertEquals(
    personalizeBody('[Planner] is planning the trip', { plannerName: 'Maya Singh' }),
    'Maya is planning the trip',
  );
});

Deno.test('personalizeBody — missing planner falls back to "your planner"', () => {
  assertEquals(
    personalizeBody('Heads up — [Planner] is locking it in.', {}),
    'Heads up — your planner is locking it in.',
  );
});

// ─── destination ──────────────────────────────────────────────────────────

Deno.test('personalizeBody — [Destination] resolves to value', () => {
  assertEquals(
    personalizeBody("We're heading to [Destination]!", { destination: 'Cancun' }),
    "We're heading to Cancun!",
  );
});

Deno.test('personalizeBody — missing destination falls back', () => {
  assertEquals(
    personalizeBody('To [Destination]', {}),
    'To the destination',
  );
});

// ─── trip ─────────────────────────────────────────────────────────────────

Deno.test('personalizeBody — [Trip] uses tripName when present', () => {
  assertEquals(
    personalizeBody("Update for [Trip]", { tripName: 'Bali 2026' }),
    'Update for Bali 2026',
  );
});

Deno.test('personalizeBody — [Trip] falls back to destination when no tripName', () => {
  assertEquals(
    personalizeBody("Update for [Trip]", { destination: 'Cancun' }),
    'Update for Cancun',
  );
});

Deno.test('personalizeBody — [Trip] falls back to "the trip" when nothing set', () => {
  assertEquals(
    personalizeBody("Update for [Trip]", {}),
    'Update for the trip',
  );
});

// ─── multi-token + edge cases ─────────────────────────────────────────────

Deno.test('personalizeBody — all four tokens substituted in one body', () => {
  const body = 'Hey [Name] — [Planner] picked [Destination] for [Trip].';
  const out = personalizeBody(body, {
    recipientName: 'Alex',
    plannerName: 'Maya',
    destination: 'Cancun',
    tripName: 'Spring Break',
  });
  assertEquals(out, 'Hey Alex — Maya picked Cancun for Spring Break.');
});

Deno.test('personalizeBody — body without tokens returned unchanged', () => {
  const body = "Hi there, hope you're well.";
  assertEquals(personalizeBody(body, { recipientName: 'Alex' }), body);
});

Deno.test('personalizeBody — empty body returns empty', () => {
  assertEquals(personalizeBody('', { recipientName: 'Alex' }), '');
});

Deno.test('personalizeBody — legacy 2-arg form (string) still works', () => {
  // Old callers passed (body, recipientName) directly.
  assertEquals(
    personalizeBody('Hey [Name]', 'Alex Carter'),
    'Hey Alex',
  );
});

Deno.test('personalizeBody — legacy 2-arg form with null', () => {
  assertEquals(
    personalizeBody('Hey [Name]', null),
    'Hey there',
  );
});

Deno.test('personalizeBody — repeated tokens all substituted', () => {
  assertEquals(
    personalizeBody('[Name], [Name], and [Name]', { recipientName: 'Alex' }),
    'Alex, Alex, and Alex',
  );
});

Deno.test('personalizeBody — does not mangle similar-but-unsupported tokens', () => {
  // [Names] is not a supported token — should pass through unchanged.
  assertEquals(
    personalizeBody('[Names] [Plan] [Tripadvisor]', { recipientName: 'Alex', plannerName: 'Maya' }),
    '[Names] [Plan] [Tripadvisor]',
  );
});

// ─── TKTK survey-link placeholder ─────────────────────────────────────────

Deno.test('personalizeBody — TKTK swapped for surveyUrl when provided', () => {
  assertEquals(
    personalizeBody('Quick survey: TKTK', {
      surveyUrl: 'https://rallysurveys.netlify.app/respond/abc123',
    }),
    'Quick survey: https://rallysurveys.netlify.app/respond/abc123',
  );
});

Deno.test('personalizeBody — multiple TKTKs all substituted', () => {
  assertEquals(
    personalizeBody('Link: TKTK or TKTK', { surveyUrl: 'https://x' }),
    'Link: https://x or https://x',
  );
});

Deno.test('personalizeBody — TKTK left literal when no surveyUrl supplied', () => {
  // Surfacing the broken link in the outbound body is loud — better than
  // silently dropping it and shipping "Link: " with nothing after.
  assertEquals(
    personalizeBody('Link: TKTK', { recipientName: 'Alex' }),
    'Link: TKTK',
  );
});

Deno.test('personalizeBody — TKTK swap is case-sensitive (lowercase passes through)', () => {
  assertEquals(
    personalizeBody('try tktk', { surveyUrl: 'https://x' }),
    'try tktk',
  );
});

Deno.test('personalizeBody — TKTK requires word boundaries (substrings ignored)', () => {
  assertEquals(
    personalizeBody('TKTKK and XTKTK', { surveyUrl: 'https://x' }),
    'TKTKK and XTKTK',
  );
});

Deno.test('personalizeBody — TKTK runs alongside other tokens', () => {
  assertEquals(
    personalizeBody('Hey [Name] — [Planner] needs your input: TKTK', {
      recipientName: 'Alex',
      plannerName: 'Maya',
      surveyUrl: 'https://x',
    }),
    'Hey Alex — Maya needs your input: https://x',
  );
});

// ─── [Survey link] (modern bracketed) ─────────────────────────────────────

Deno.test('personalizeBody — [Survey link] swapped for surveyUrl', () => {
  assertEquals(
    personalizeBody('Quick survey: [Survey link]', {
      surveyUrl: 'https://rallysurveys.netlify.app/respond/abc',
    }),
    'Quick survey: https://rallysurveys.netlify.app/respond/abc',
  );
});

Deno.test('personalizeBody — [Survey link] is case-insensitive', () => {
  assertEquals(
    personalizeBody('try [survey link] and [SURVEY LINK]', { surveyUrl: 'https://x' }),
    'try https://x and https://x',
  );
});

Deno.test('personalizeBody — [Survey link] left literal when no surveyUrl', () => {
  assertEquals(
    personalizeBody('Quick: [Survey link]', { recipientName: 'Alex' }),
    'Quick: [Survey link]',
  );
});

Deno.test('personalizeBody — TKTK and [Survey link] both substituted in one body', () => {
  assertEquals(
    personalizeBody('Old: TKTK · New: [Survey link]', { surveyUrl: 'https://x' }),
    'Old: https://x · New: https://x',
  );
});
