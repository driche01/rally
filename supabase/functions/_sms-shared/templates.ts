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

// ─── Join-link templates ────────────────────────────────────────────────────

function formatDateRange(dates: { start?: string; end?: string } | null | undefined): string {
  if (!dates?.start || !dates?.end) return '';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const s = new Date(dates.start + 'T12:00:00');
  const e = new Date(dates.end + 'T12:00:00');
  if (isNaN(s.getTime()) || isNaN(e.getTime())) return '';
  return `${months[s.getMonth()]} ${s.getDate()}\u2013${e.getDate()}`;
}

/**
 * The SMS sent to a phone after they fill out the /join/[code] form.
 * The recipient must reply YES (or NO/STOP) to be promoted from a
 * pending submission to an active trip session participant.
 *
 * Trust framing: lead with planner name + relationship cue ("added you")
 * so the recipient understands this is a friend invite, not a cold blast.
 */
export function joinConfirmationSms(opts: {
  recipientName: string;
  plannerName: string | null;
  destination?: string | null;
  dates?: { start?: string; end?: string } | null;
}): string {
  const planner = opts.plannerName ?? 'A friend';
  const dest = opts.destination ? ` to ${opts.destination}` : '';
  const range = formatDateRange(opts.dates);
  const datesPart = range ? ` (${range})` : '';
  return (
    `Hey ${opts.recipientName} \u2014 ${planner} added you to a trip${dest}${datesPart}. ` +
    `I'm Rally, I help plan it over text. ` +
    `Reply YES to join, or STOP to opt out.`
  );
}

/**
 * Sent immediately after a participant replies YES to join confirmation.
 * Marks the start of their 1:1 thread with Rally for this trip.
 */
export function joinKickoffSms(opts: {
  plannerName: string | null;
  destination?: string | null;
}): string {
  const planner = opts.plannerName ?? 'Your friend';
  const dest = opts.destination ? ` to ${opts.destination}` : '';
  return (
    `You're in. ${planner} is planning a trip${dest}. ` +
    `I'll text you here as decisions come up \u2014 reply HELP anytime to see what I can do.`
  );
}
