/**
 * Outbound SMS templates — post-pivot.
 *
 * Rally's surface is reduced to: join-link onboarding, app install, and
 * carrier-compliance keywords. The conversational templates (introMessage,
 * plannerWelcomeOneToOne, plannerKickoffWithLink, etc.) are gone — their
 * code paths were retired in the Phase 5.6 kill-switch.
 */

export type Channel = 'sms' | 'whatsapp';

/**
 * Append a "Get the app" CTA line if the URL looks valid.
 * Fails closed: an unset or malformed URL drops the CTA rather than
 * sending a broken link.
 */
function appDownloadLine(appDownloadUrl: string | null | undefined): string | null {
  if (!appDownloadUrl) return null;
  const trimmed = appDownloadUrl.trim();
  if (!/^(https?:\/\/|exp:\/\/)/i.test(trimmed)) return null;
  return `Get the app: ${trimmed}`;
}

/**
 * Response to the "APP" / "GET APP" / "DOWNLOAD" keyword. Always
 * available regardless of session state. Silent fallback if no URL is
 * configured so users aren't told to download a nonexistent link.
 */
export function appKeywordReply(opts: {
  appDownloadUrl?: string | null;
}): string | null {
  const cta = appDownloadLine(opts.appDownloadUrl);
  if (!cta) return null;
  return `${cta}\n\nYou'll see your trips, polls, and everything we're planning here.`;
}

/** Detects the "APP"-style keyword in an inbound body. Case-insensitive. */
export function isAppKeyword(body: string): boolean {
  return /^\s*(app|get\s+(the\s+)?app|download(\s+(rally|app))?|rally\s+app)\s*\??\s*$/i.test(body);
}


// ─── Planner-managed roster templates ─────────────────────────────────────
// Used when the planner adds or removes a member from the trip-edit screen
// (or the Group Dashboard). Unlike the join-handshake confirmation, these
// don't require a YES reply — they go out as one-shot informational texts.

/**
 * Sent when a planner adds someone to the trip from inside the app. The
 * recipient gets the survey link directly so they can respond without
 * waiting for the YES handshake. Always closes with STOP wording for
 * carrier compliance.
 */
export function addedToTripSms(opts: {
  recipientName: string | null;
  plannerName: string | null;
  destination?: string | null;
  surveyUrl: string;
}): string {
  const planner = firstName(opts.plannerName) ?? 'A friend';
  const dest = opts.destination ? ` to ${opts.destination}` : '';
  const recipient = firstName(opts.recipientName);
  const greet = recipient ? `Hey ${recipient} — ` : '';
  return (
    `${greet}${planner} added you to a trip${dest}. ` +
    `Take 30 seconds to share what works for you: ${opts.surveyUrl}. ` +
    `Reply STOP to opt out.`
  );
}

/**
 * Sent when a planner removes someone from the trip. Best-effort
 * informational — Rally has already stopped sending them nudges by the
 * time this fires.
 */
export function removedFromTripSms(opts: {
  plannerName: string | null;
  destination?: string | null;
}): string {
  const planner = firstName(opts.plannerName) ?? 'Your planner';
  const dest = opts.destination ? ` ${opts.destination}` : '';
  return (
    `${planner} removed you from the${dest} trip. ` +
    `You won't get more messages from Rally about it.`
  );
}

// ─── Nudge templates (cadence engine) ──────────────────────────────────────
// Each kind keeps the same survey link; only the framing changes. Body
// length stays under 160 chars when possible to avoid concatenated SMS
// billing on toll-free.

export interface NudgeBodyOpts {
  recipientName: string | null;
  plannerName: string | null;
  destination: string | null;
  surveyUrl: string;
  /** Days until the planner's external book-by date. Optional. */
  daysUntilBookBy?: number | null;
  /** Internal response deadline (ISO 'YYYY-MM-DD'). Drives the "by [date]" framing. */
  responsesDueDate?: string | null;
  /**
   * Social proof — first names of responders so far (excludes the recipient
   * and the planner). Caller decides ordering; we slice the first 3 here.
   */
  responderNames?: string[];
  /** Total non-planner participants who have meaningfully responded. */
  respondedCount?: number;
  /** Total non-planner participants on the trip (the denominator). */
  totalCount?: number;
}

/**
 * Social-proof clause with names. Format B (per product):
 *   "Alex has answered, 4 left."
 *   "Alex and Sam have answered, 3 left."
 *   "Alex, Sam, and Jordan have answered, 2 left."
 *   "Alex, Sam, Jordan, and 2 others have answered, 3 left."
 *
 * Returns '' when there's no proof to share (zero responders or zero total).
 * The "X left" tail is dropped if everyone's already in.
 */
export function socialProofWithNames(
  names: string[],
  respondedCount: number,
  totalCount: number,
): string {
  if (respondedCount <= 0 || names.length === 0 || totalCount <= 0) return '';
  const visible = names.slice(0, 3);
  const overflow = Math.max(0, respondedCount - visible.length);
  const remaining = Math.max(0, totalCount - respondedCount);

  let phrase: string;
  if (overflow > 0) {
    // 3 visible + N others
    const otherWord = overflow === 1 ? 'other' : 'others';
    phrase = `${visible[0]}, ${visible[1]}, ${visible[2]}, and ${overflow} ${otherWord} have answered`;
  } else if (visible.length === 1) {
    phrase = `${visible[0]} has answered`;
  } else if (visible.length === 2) {
    phrase = `${visible[0]} and ${visible[1]} have answered`;
  } else {
    phrase = `${visible[0]}, ${visible[1]}, and ${visible[2]} have answered`;
  }
  return remaining > 0 ? `${phrase}, ${remaining} left.` : `${phrase}.`;
}

/**
 * Count-only social proof, used on rd_minus_2 / rd_minus_1 where the names
 * list might be long and the deadline framing is doing the urgency lift.
 *   "4 of 7 in, 3 still left."
 */
export function socialProofCountOnly(respondedCount: number, totalCount: number): string {
  if (totalCount <= 0) return '';
  const remaining = Math.max(0, totalCount - respondedCount);
  if (remaining <= 0) return '';
  return `${respondedCount} of ${totalCount} in, ${remaining} still left.`;
}

export function formatShortDate(iso: string): string {
  // "Mon May 6" — same shape as src/lib/cadence.ts formatCadenceDate so the
  // app preview and the actual SMS body stay visually consistent.
  const d = new Date(iso + 'T16:00:00.000Z');
  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${days[d.getUTCDay()]} ${months[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

function firstName(n: string | null): string | null {
  if (!n) return null;
  const t = n.trim();
  if (!t) return null;
  return t.split(/\s+/)[0];
}

export function initialOutreachSms(opts: NudgeBodyOpts): string {
  const planner = firstName(opts.plannerName) ?? 'A friend';
  const tripPhrase = opts.destination ? `a ${opts.destination} trip` : 'a trip';
  const recipient = firstName(opts.recipientName);
  const greet = recipient ? `Hey ${recipient} ` : '';
  const byDate = opts.responsesDueDate ? ` by ${formatShortDate(opts.responsesDueDate)}` : '';
  return (
    `${greet}\u2014 ${planner}'s planning ${tripPhrase} and wants your picks${byDate}. ` +
    `Quick survey, no login: ${opts.surveyUrl}`
  );
}

export function nudgeBody(kind: 'd1' | 'd3' | 'heartbeat' | 'rd_minus_2' | 'rd_minus_1', opts: NudgeBodyOpts): string {
  const tripWord = opts.destination ? `${opts.destination} trip` : 'trip';
  const link = opts.surveyUrl;

  const namesProof = socialProofWithNames(
    opts.responderNames ?? [],
    opts.respondedCount ?? 0,
    opts.totalCount ?? 0,
  );
  const countProof = socialProofCountOnly(
    opts.respondedCount ?? 0,
    opts.totalCount ?? 0,
  );
  const namesClause = namesProof ? ` ${namesProof}` : '';
  const countClause = countProof ? ` ${countProof}` : '';

  switch (kind) {
    case 'd1':
      return `Hey \u2014 your ${tripWord} survey is open.${namesClause} 2 mins, no login: ${link}`;
    case 'd3':
      return `Your ${tripWord} is shaping up.${namesClause} Toss in your picks: ${link}`;
    case 'heartbeat':
      return `Your ${tripWord} survey is still hanging out, ready when you are.${namesClause} ${link}`;
    case 'rd_minus_2':
      return `Heads up \u2014 2 days to weigh in on your ${tripWord}.${countClause} Quick survey: ${link}`;
    case 'rd_minus_1':
      return `Last call \u2014 your ${tripWord} locks in tomorrow.${countClause} ${link}`;
  }
}

// ─── Synthesis milestone templates ─────────────────────────────────────────
// Sent to the whole group (responders + non-responders) when a milestone
// is crossed. The body includes a leader summary if available, plus a link
// to the public live results page.

export interface SynthBodyOpts {
  plannerName: string | null;
  destination: string | null;
  /** e.g. 'rallysurveys.netlify.app/results/<token>' */
  resultsUrl: string;
  respondedCount: number;
  totalCount: number;
  /**
   * Generic top-option labels for half / pre_due milestones (e.g. ['Cancun', 'Jun 12-19']).
   * Synthesized from whatever polls have at least one vote.
   */
  leaders?: string[];
  /**
   * Structured leaders for the full milestone \u2014 one per canonical poll type.
   * Any subset can be present; missing keys are dropped from the body.
   */
  fullLeaders?: {
    destination?: string | null;
    dates?: string | null;
    duration?: string | null;
    budget?: string | null;
  };
}

function leaderClause(opts: SynthBodyOpts): string {
  if (!opts.leaders || opts.leaders.length === 0) return '';
  const list = opts.leaders.slice(0, 2).join(', ');
  return ` Leading: ${list}.`;
}

function fullLeaderClause(opts: SynthBodyOpts): string {
  const fl = opts.fullLeaders;
  if (!fl) return '';
  const parts: string[] = [];
  // Order matches the format the planner sees in the dashboard:
  // destination \u00b7 dates \u00b7 duration \u00b7 budget.
  if (fl.destination) parts.push(fl.destination);
  if (fl.dates) parts.push(fl.dates);
  if (fl.duration) parts.push(fl.duration);
  if (fl.budget) parts.push(fl.budget);
  if (parts.length === 0) return '';
  return ` Leading: ${parts.join(' \u00b7 ')}.`;
}

export function synthHalfSms(opts: SynthBodyOpts): string {
  const tripWord = opts.destination ? `${opts.destination} trip` : 'trip';
  return (
    `Halfway there \u2014 ${opts.respondedCount} of ${opts.totalCount} in on your ${tripWord}.${leaderClause(opts)} ` +
    `See live results: ${opts.resultsUrl}`
  );
}

export function synthFullSms(opts: SynthBodyOpts): string {
  const planner = firstName(opts.plannerName) ?? 'your planner';
  const tripWord = opts.destination ? `${opts.destination} trip` : 'trip';
  return (
    `Everyone's in on your ${tripWord} \u2014 ${opts.totalCount} of ${opts.totalCount}. ` +
    `${planner} will lock in plans next.${fullLeaderClause(opts)} ${opts.resultsUrl}`
  );
}

export function synthPreDueSms(opts: SynthBodyOpts): string {
  const tripWord = opts.destination ? `${opts.destination} trip` : 'trip';
  const missing = opts.totalCount - opts.respondedCount;
  return (
    `Heads up \u2014 your ${tripWord} locks in tomorrow. ` +
    `${missing} ${missing === 1 ? 'person hasn\'t' : 'people haven\'t'} responded yet.${leaderClause(opts)} ` +
    `${opts.resultsUrl}`
  );
}
