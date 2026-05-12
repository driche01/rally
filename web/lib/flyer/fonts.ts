/**
 * Font loader for the flyer renderer. ImageResponse (next/og) needs
 * font bytes as ArrayBuffer. We fetch from Google Fonts on first
 * use and cache in module scope for the lifetime of the Node
 * runtime process — subsequent renders pay no font-fetch cost.
 *
 * Two families:
 *   - "Inter" (sans) for body + small UI text
 *   - "Lora" (serif) standing in for Georgia (Georgia is not free /
 *     not redistributable); Lora has the same warm-editorial feel.
 *
 * Per-weight cache: weights 400, 600, 700 for Inter; 400, 700 for Lora.
 */

interface FontEntry {
  name: string;
  data: ArrayBuffer;
  weight: 400 | 600 | 700;
  style: "normal" | "italic";
}

let cached: FontEntry[] | null = null;

// Direct .ttf URLs from the Google Fonts s/static endpoint.
// Picked specific known-stable hashes; if Google rotates them
// (rare) we re-discover by visiting fonts.google.com/specimen and
// inspecting the network tab.
const SOURCES = [
  { family: "Inter", weight: 400, url: "https://fonts.gstatic.com/s/inter/v18/UcCO3FwrK3iLTeHuS_nVMrMxCp50ojIa1ZL7.woff2" },
  { family: "Inter", weight: 600, url: "https://fonts.gstatic.com/s/inter/v18/UcCO3FwrK3iLTeHuS_nVMrMxCp50ojIa0ZL7.woff2" },
  { family: "Inter", weight: 700, url: "https://fonts.gstatic.com/s/inter/v18/UcCO3FwrK3iLTeHuS_nVMrMxCp50ojIaxJL7.woff2" },
  { family: "Lora",  weight: 400, url: "https://fonts.gstatic.com/s/lora/v35/0QI6MX1D_JOuGQbT0gvTJPa787weuxJBkqg.woff2" },
  { family: "Lora",  weight: 700, url: "https://fonts.gstatic.com/s/lora/v35/0QI6MX1D_JOuGQbT0gvTJPa787wsuhJBkqg.woff2" },
] as const;

/**
 * Returns the fonts in the format ImageResponse expects.
 * Caches across requests; first call costs ~5 KB × N fetches.
 */
export async function loadFlyerFonts(): Promise<FontEntry[]> {
  if (cached) return cached;
  const fetched = await Promise.all(
    SOURCES.map(async (s) => {
      const res = await fetch(s.url);
      if (!res.ok) {
        throw new Error(`font_fetch_failed: ${s.family} ${s.weight} ${res.status}`);
      }
      const data = await res.arrayBuffer();
      return {
        name: s.family,
        data,
        weight: s.weight as 400 | 600 | 700,
        style: "normal" as const,
      };
    }),
  );
  cached = fetched;
  return fetched;
}
