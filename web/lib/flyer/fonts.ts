/**
 * Font loader for the flyer renderer.
 *
 * Reads font bytes from the npm-installed @fontsource packages
 * rather than fetching from Google Fonts at runtime (Google
 * rotates CDN hashes; flyer rendering would intermittently 404).
 * Version-pinned, deterministic, no network call.
 *
 * Two families:
 *   - Inter (sans) for body + UI: weights 400, 600, 700
 *   - Lora (serif) standing in for Georgia: weights 400, 700
 *     (Georgia isn't free / not redistributable; Lora is the
 *     same warm-editorial feel.)
 *
 * Satori supports WOFF, TTF, OTF. We use WOFF (smallest of the
 * three; @fontsource ships both .woff and .woff2 — we pick .woff).
 */

import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

interface FontEntry {
  name: string;
  data: ArrayBuffer;
  weight: 400 | 600 | 700;
  style: "normal" | "italic";
}

const SOURCES: { family: "Inter" | "Lora"; weight: 400 | 600 | 700; pkgFile: string }[] = [
  { family: "Inter", weight: 400, pkgFile: "@fontsource/inter/files/inter-latin-400-normal.woff" },
  { family: "Inter", weight: 600, pkgFile: "@fontsource/inter/files/inter-latin-600-normal.woff" },
  { family: "Inter", weight: 700, pkgFile: "@fontsource/inter/files/inter-latin-700-normal.woff" },
  { family: "Lora",  weight: 400, pkgFile: "@fontsource/lora/files/lora-latin-400-normal.woff"  },
  { family: "Lora",  weight: 700, pkgFile: "@fontsource/lora/files/lora-latin-700-normal.woff"  },
];

let cached: FontEntry[] | null = null;

/**
 * Returns the fonts in the format ImageResponse expects. First call
 * reads from disk; subsequent calls hit the in-memory cache.
 */
export async function loadFlyerFonts(): Promise<FontEntry[]> {
  if (cached) return cached;
  const loaded = await Promise.all(
    SOURCES.map(async (s) => {
      const path = require.resolve(s.pkgFile);
      const buf = await readFile(path);
      return {
        name: s.family,
        data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
        weight: s.weight,
        style: "normal" as const,
      };
    }),
  );
  cached = loaded;
  return loaded;
}
