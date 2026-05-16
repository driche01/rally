/**
 * GET /api/gifs/search?q=<query>&limit=<n>
 *
 * Proxies the Giphy v1 search API so the GIPHY_API_KEY stays
 * server-side. Returns a trimmed shape — only the URLs +
 * dimensions the activity-feed picker needs.
 *
 * Giphy free tier:
 *   - "Beta" key: 1000 req/hour, 10k req/day. Sign up at
 *     https://developers.giphy.com/dashboard/ — create an SDK
 *     app, copy the API key.
 *   - No client_key concept like Tenor — single api_key handles
 *     auth.
 *
 * If GIPHY_API_KEY is unset, returns 503 with a `key_missing`
 * code so the client can render a "GIF picker not configured"
 * message gracefully without breaking the activity feed.
 */

import { jsonErr, jsonOk } from "@/lib/http";

interface GiphyImage {
  url: string;
  width: string;   // Giphy returns these as strings, not numbers
  height: string;
}
interface GiphyResult {
  id: string;
  title: string;
  images: Record<string, GiphyImage | undefined>;
}
interface GiphySearchResponse {
  data?: GiphyResult[];
  meta?: { status: number; msg: string };
}

export async function GET(req: Request) {
  const apiKey = process.env.GIPHY_API_KEY;
  if (!apiKey) {
    return jsonErr(503, "key_missing", "Server-side GIPHY_API_KEY env var is not set.");
  }

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const limit = Math.min(
    Math.max(parseInt(url.searchParams.get("limit") ?? "16", 10) || 16, 1),
    32,
  );
  if (!q) return jsonErr(400, "query_required");

  // rating=pg-13 is the polite default for a planner-context app.
  // The picker can be loosened later if needed.
  const giphyUrl =
    `https://api.giphy.com/v1/gifs/search?` +
    new URLSearchParams({
      api_key: apiKey,
      q,
      limit:  String(limit),
      rating: "pg-13",
      bundle: "messaging_non_clips",
    }).toString();

  let res: Response;
  try {
    res = await fetch(giphyUrl, { cache: "no-store" });
  } catch (e) {
    return jsonErr(502, "giphy_unreachable", String(e));
  }
  if (!res.ok) {
    return jsonErr(502, "giphy_bad_response", `${res.status} ${res.statusText}`);
  }

  const body = (await res.json()) as GiphySearchResponse;
  const gifs = (body.data ?? []).map((r) => {
    // `fixed_width_small` is the cheapest preview (good for the
    // grid); `original` is the full-quality post the user picks.
    const tiny = r.images.fixed_width_small ?? r.images.fixed_width ?? r.images.original;
    const full = r.images.original ?? r.images.fixed_width ?? tiny;
    return {
      id: r.id,
      title: r.title || "",
      preview_url: tiny?.url ?? null,
      preview_w:   tiny ? parseInt(tiny.width,  10) || null : null,
      preview_h:   tiny ? parseInt(tiny.height, 10) || null : null,
      url:    full?.url ?? null,
      width:  full ? parseInt(full.width,  10) || null : null,
      height: full ? parseInt(full.height, 10) || null : null,
    };
  });

  return jsonOk({ gifs });
}
