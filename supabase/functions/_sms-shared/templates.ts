/**
 * Outbound message templates.
 *
 * Single source of truth for all Rally-initiated copy that's shared
 * across the SMS pipeline AND the test harness. Importing these into
 * `prototype testing scenarios/**` fixtures means changing a template
 * here automatically updates the expected test output — no manual
 * fixture regeneration.
 *
 * Transport-agnostic: the `channel` discriminator lets us tweak copy
 * for SMS vs. WhatsApp (opt-out instructions differ, character limits
 * differ, etc.) without forking templates.
 */

export type Channel = 'sms' | 'whatsapp';

/**
 * Append a "Get the app" CTA line if the URL looks valid.
 * Fails closed: an unset or malformed URL drops the CTA rather than
 * sending a broken link. Prevents an ops typo from reaching users.
 */
function appDownloadLine(appDownloadUrl: string | null | undefined): string | null {
  if (!appDownloadUrl) return null;
  const trimmed = appDownloadUrl.trim();
  if (!/^(https?:\/\/|exp:\/\/)/i.test(trimmed)) return null;
  return `Get the app: ${trimmed}`;
}

/**
 * Channel-specific opt-out footer.
 * SMS: "Reply STOP to opt out." (carrier compliance)
 * WhatsApp: users use the block/mute affordances, so a STOP line is unnecessary
 * but we still support a one-word opt-out keyword for parity.
 */
function optOutLine(channel: Channel): string {
  return channel === 'sms'
    ? 'Reply STOP anytime to opt out.'
    : 'Message STOP anytime to opt out.';
}

// ─── Templates ──────────────────────────────────────────────────────────────

/**
 * The first outbound message Rally sends when joined to a new group thread.
 * Deliberately does NOT carry a download CTA — the intro is pre-value, and
 * carriers flag novel URLs in first outbounds. The install prompt is surfaced
 * through `plannerWelcomeOneToOne`, `appKeywordReply`, and `tripRecapFooter`
 * instead — moments where the user has already seen Rally work.
 */
export function introMessage(opts: { channel: Channel }): string {
  return (
    `Hey! I'm Rally \u{1F44B} I help groups plan trips fast. ` +
    `Everyone drop your name and a destination you'd wanna hit \u2014 ` +
    `format it like "Name \u2014 destination". ${optOutLine(opts.channel)}`
  );
}

/**
 * Sent once, the first time a phone that's new to Rally messages the
 * Rally number 1:1 (not a group). The place to surface the app install
 * prompt: the user has already demonstrated interest by initiating
 * contact, and a 1:1 thread is a low-noise surface.
 */
export function plannerWelcomeOneToOne(opts: {
  channel: Channel;
  appDownloadUrl?: string | null;
}): string {
  const lines = [
    `Hey! I'm Rally \u{1F44B} I help groups plan trips over text.`,
    `To start: add me to a group chat with the people you want to travel with, and I'll take it from there.`,
  ];
  const cta = appDownloadLine(opts.appDownloadUrl);
  if (cta) lines.push(cta);
  lines.push(optOutLine(opts.channel));
  return lines.join('\n\n');
}

/**
 * Response to the "APP" / "GET APP" / "DOWNLOAD" keyword. Always
 * available — works in 1:1 and group threads, regardless of session state.
 * Silent fallback if no URL is configured so users aren't told to download
 * a nonexistent link.
 */
export function appKeywordReply(opts: {
  appDownloadUrl?: string | null;
}): string | null {
  const cta = appDownloadLine(opts.appDownloadUrl);
  if (!cta) return null;
  return `${cta}\n\nYou'll see your trips, polls, and everything we're planning here.`;
}

/**
 * Footer appended to trip-recap / welcome-back / view-trip outbound
 * messages. Only renders when a URL is configured AND a tripId is
 * supplied — otherwise returns an empty string so the caller can
 * concatenate safely.
 */
export function tripRecapFooter(opts: {
  tripId?: string | null;
  appDownloadUrl?: string | null;
}): string {
  const base = opts.appDownloadUrl?.replace(/\/+$/, '');
  if (!base || !/^(https?:\/\/|exp:\/\/)/i.test(base)) return '';
  const url = opts.tripId ? `${base}/t/${opts.tripId}` : base;
  return `\n\nSee it in the app: ${url}`;
}

/** Detects the "APP"-style keyword in an inbound body. Case-insensitive. */
export function isAppKeyword(body: string): boolean {
  return /^\s*(app|get\s+(the\s+)?app|download(\s+(rally|app))?|rally\s+app)\s*\??\s*$/i.test(body);
}
