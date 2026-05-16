/**
 * Shared trip-link footer for outbound SMS.
 *
 * Goal: every text Rally sends ends with a clickable link back to
 * the trip's invite page, so recipients can always get back to the
 * source. Per-template authors don't have to remember to splice in
 * the URL — they call appendTripFooter() and it's handled.
 *
 * Footer shape:
 *   <body>
 *
 *   → https://rally/invite/<token>
 *
 * Two blank lines + an arrow keeps the link visually distinct from
 * the message body and survives carrier-side line wrapping.
 *
 * Idempotent: if the body already contains the URL (some templates
 * splice it inline mid-sentence, like the invitation CTA), the
 * footer is skipped — no double link.
 *
 * Build the URL from `share_token` only (not the full URL) — keeps
 * the helper portable across environments (dev, prod, preview)
 * since `getSiteUrl()` returns the appropriate origin.
 */

import { getSiteUrl } from "./site-url";

const FOOTER_PREFIX = "\n\n→ ";

/**
 * Append the trip-link footer to a message body. Pass the trip's
 * share_token; the helper resolves the full origin and assembles
 * the invite URL.
 */
export async function appendTripFooter(body: string, shareToken: string): Promise<string> {
  const base = await getSiteUrl();
  const url = `${base}/invite/${shareToken}`;
  return appendTripFooterWithUrl(body, url);
}

/**
 * Same as appendTripFooter but takes a pre-built URL — useful when
 * the caller already has the URL (e.g. composed it for other
 * splices in the same body).
 */
export function appendTripFooterWithUrl(body: string, url: string): string {
  if (!body) return body;
  if (body.includes(url)) return body; // already mentions the link inline
  return `${body.trimEnd()}${FOOTER_PREFIX}${url}`;
}
