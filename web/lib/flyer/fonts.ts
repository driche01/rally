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
 *
 * NOTE on resolution: @fontsource's package.json `exports` field
 * only exposes the .css entry point — `require.resolve` won't
 * reach the .woff files directly even though they're on disk.
 * Workaround: resolve `index.css` (which IS exposed), then derive
 * the /files/ path from its directory.
 */

import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

interface FontEntry {
  name: string;
  data: ArrayBuffer;
  weight: 400 | 600 | 700;
  style: "normal" | "italic";
}

const SOURCES: { family: "Inter" | "Lora"; pkg: string; weight: 400 | 600 | 700; file: string }[] = [
  { family: "Inter", pkg: "@fontsource/inter", weight: 400, file: "inter-latin-400-normal.woff" },
  { family: "Inter", pkg: "@fontsource/inter", weight: 600, file: "inter-latin-600-normal.woff" },
  { family: "Inter", pkg: "@fontsource/inter", weight: 700, file: "inter-latin-700-normal.woff" },
  { family: "Lora",  pkg: "@fontsource/lora",  weight: 400, file: "lora-latin-400-normal.woff"  },
  { family: "Lora",  pkg: "@fontsource/lora",  weight: 700, file: "lora-latin-700-normal.woff"  },
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
      // index.css is exposed in the package's exports field; resolve
      // it, then walk to ./files/<font>.woff alongside it.
      const cssPath = require.resolve(`${s.pkg}/index.css`);
      const fontPath = join(dirname(cssPath), "files", s.file);
      const buf = await readFile(fontPath);
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
