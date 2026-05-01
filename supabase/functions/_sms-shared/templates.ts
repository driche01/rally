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
  const dest = opts.destination ? ` to ${opts.destination}` : '';
  const recipient = firstName(opts.recipientName);
  const greet = recipient ? `Hey ${recipient} ` : '';
  const byDate = opts.responsesDueDate ? ` by ${formatShortDate(opts.responsesDueDate)}` : '';
  return (
    `${greet}\u2014 ${planner} is planning a trip${dest} and wants your input${byDate}. ` +
    `Quick survey (no login): ${opts.surveyUrl}`
  );
}

export function nudgeBody(kind: 'd1' | 'd3' | 'heartbeat' | 'rd_minus_2' | 'rd_minus_1', opts: NudgeBodyOpts): string {
  const planner = firstName(opts.plannerName) ?? 'your friend';
  const dest = opts.destination ? ` (${opts.destination})` : '';
  const link = opts.surveyUrl;
  switch (kind) {
    case 'd1':
      return `Quick reminder: ${planner}'s trip survey${dest} is open. Takes 2 min: ${link}`;
    case 'd3':
      return `Still gathering responses for ${planner}'s trip${dest}. Tap when you have a sec: ${link}`;
    case 'heartbeat':
      return `${planner}'s trip survey${dest} is still open. Pop in when you're ready: ${link}`;
    case 'rd_minus_2':
      return `${planner} needs everyone's answers in 2 days. Quick survey: ${link}`;
    case 'rd_minus_1':
      return `Last call \u2014 ${planner} is locking in trip plans tomorrow. ${link}`;
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
  /** Top option per poll, e.g. ['Cancun', 'Jun 12-19']. Optional. */
  leaders?: string[];
}

function leaderClause(opts: SynthBodyOpts): string {
  if (!opts.leaders || opts.leaders.length === 0) return '';
  const list = opts.leaders.slice(0, 2).join(', ');
  return ` Leading: ${list}.`;
}

export function synthHalfSms(opts: SynthBodyOpts): string {
  const planner = firstName(opts.plannerName) ?? 'Your planner';
  const dest = opts.destination ? ` to ${opts.destination}` : '';
  return (
    `Halfway there \u2014 ${opts.respondedCount} of ${opts.totalCount} have responded ` +
    `for ${planner}'s trip${dest}.${leaderClause(opts)} See live results: ${opts.resultsUrl}`
  );
}

export function synthFullSms(opts: SynthBodyOpts): string {
  const planner = firstName(opts.plannerName) ?? 'Your planner';
  return (
    `Everyone's in for ${planner}'s trip \u2014 ${opts.totalCount} of ${opts.totalCount}. ` +
    `${planner} will lock in plans next.${leaderClause(opts)} ${opts.resultsUrl}`
  );
}

export function synthPreDueSms(opts: SynthBodyOpts): string {
  const planner = firstName(opts.plannerName) ?? 'Your planner';
  const missing = opts.totalCount - opts.respondedCount;
  return (
    `Heads up \u2014 ${planner} is locking in plans tomorrow. ` +
    `${missing} ${missing === 1 ? 'person hasn\'t' : 'people haven\'t'} responded yet.${leaderClause(opts)} ` +
    `${opts.resultsUrl}`
  );
}
