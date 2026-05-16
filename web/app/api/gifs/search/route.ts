/**
 * GET /api/gifs/search?q=<query>&limit=<n>
 *
 * Proxies the Tenor v2 search API so the TENOR_API_KEY stays
 * server-side. Returns a trimmed shape — only the URL + dimensions
 * the picker needs.
 *
 * Tenor free tier: 1000 requests / day per key (sufficient for
 * alpha). Sign up at https://developers.google.com/tenor/guides/quickstart
 *
 * If TENOR_API_KEY is unset, returns 503 with a `key_missing` code
 * so the client can render a "GIF picker not configured" message
 * gracefully without breaking the activity feed.
 */

import { jsonErr, jsonOk } from "@/lib/http";

interface TenorMediaFormat {
  url: string;
  dims: [number, number];
  duration?: number;
  size?: number;
}
interface TenorResult {
  id: string;
  title: string;
  content_description?: string;
  media_formats: Record<string, TenorMediaFormat>;
}
interface TenorSearchResponse {
  results?: TenorResult[];
  next?: string;
}

export async function GET(req: Request) {
  const apiKey = process.env.TENOR_API_KEY;
  if (!apiKey) {
    return jsonErr(503, "key_missing", "Server-side TENOR_API_KEY env var is not set.");
  }

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") ?? "16", 10) || 16, 1), 32);
  if (!q) return jsonErr(400, "query_required");

  // `client_key` is Tenor's recommended per-app identifier (free-text).
  // `media_filter=tinygif,gif` trims response size to what the picker
  // actually renders (tiny preview + full-quality post).
  const tenorUrl =
    `https://tenor.googleapis.com/v2/search?` +
    new URLSearchParams({
      q,
      key: apiKey,
      client_key: "rally-web",
      limit: String(limit),
      media_filter: "tinygif,gif",
      contentfilter: "high",   // off / low / medium / high — alpha cohort = high
    }).toString();

  let res: Response;
  try {
    res = await fetch(tenorUrl, { cache: "no-store" });
  } catch (e) {
    return jsonErr(502, "tenor_unreachable", String(e));
  }
  if (!res.ok) {
    return jsonErr(502, "tenor_bad_response", `${res.status} ${res.statusText}`);
  }

  const body = (await res.json()) as TenorSearchResponse;
  const gifs = (body.results ?? []).map((r) => {
    const tiny = r.media_formats.tinygif ?? r.media_formats.gif;
    const full = r.media_formats.gif ?? r.media_formats.tinygif;
    return {
      id: r.id,
      title: r.content_description || r.title || "",
      preview_url: tiny?.url ?? null,
      preview_w:   tiny?.dims?.[0] ?? null,
      preview_h:   tiny?.dims?.[1] ?? null,
      url:    full?.url ?? null,
      width:  full?.dims?.[0] ?? null,
      height: full?.dims?.[1] ?? null,
    };
  });

  return jsonOk({ gifs });
}
