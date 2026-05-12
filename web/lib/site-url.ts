/**
 * Site-URL helper. Builds the absolute base URL for share links
 * (invite URLs, etc.).
 *
 * Resolution order:
 *   1. NEXT_PUBLIC_SITE_URL if set AND not localhost-ish — wins
 *      for production deploys.
 *   2. Else read x-forwarded-* + host headers off the current
 *      request. This is the trick that makes SMS / cross-device
 *      links Just Work in dev: if the planner is hitting Rally on
 *      `http://192.168.0.231:3000`, the share link they generate
 *      goes to the same `http://192.168.0.231:3000/invite/...`,
 *      which their friend's phone can reach over the same WiFi.
 *   3. Last-resort fallback: `http://localhost:3000`.
 */

import { headers } from "next/headers";

/** Server-component / route-handler safe. */
export async function getSiteUrl(): Promise<string> {
  const env = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (env && !isLocalish(env)) return env.replace(/\/$/, "");

  try {
    const h = await headers();
    const proto = h.get("x-forwarded-proto") ?? "http";
    const host  = h.get("x-forwarded-host") ?? h.get("host");
    if (host) return `${proto}://${host}`;
  } catch {
    // headers() throws outside a request context; fall through.
  }

  return env ?? "http://localhost:3000";
}

function isLocalish(url: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:|\/|$)/i.test(url);
}
