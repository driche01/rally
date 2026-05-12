/**
 * Font loader for the flyer renderer.
 *
 * Reads font bytes from .woff files committed alongside this
 * module. Earlier iterations tried (a) fetching from Google Fonts
 * (their CDN rotates hashes → 404s) and (b) resolving the
 * @fontsource npm packages (their package.json `exports` field
 * locks down resolution beyond .css). Both failed in dev.
 *
 * Shipping the bytes in-repo is ~150 KB total (5 × ~30 KB),
 * deterministic, zero network, zero package-manager dance.
 *
 * Two families:
 *   - Inter (sans) for body + UI: weights 400, 600, 700
 *   - Lora (serif) standing in for Georgia: weights 400, 700
 *     (Georgia isn't free / not redistributable; Lora is the
 *     same warm-editorial feel.)
 *
 * Satori supports WOFF, TTF, OTF. We ship WOFF.
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const FONT_DIR = join(dirname(fileURLToPath(import.meta.url)), "fonts");

interface FontEntry {
  name: string;
  data: ArrayBuffer;
  weight: 400 | 600 | 700;
  style: "normal" | "italic";
}

const SOURCES: { family: "Inter" | "Lora"; weight: 400 | 600 | 700; file: string }[] = [
  { family: "Inter", weight: 400, file: "inter-latin-400-normal.woff" },
  { family: "Inter", weight: 600, file: "inter-latin-600-normal.woff" },
  { family: "Inter", weight: 700, file: "inter-latin-700-normal.woff" },
  { family: "Lora",  weight: 400, file: "lora-latin-400-normal.woff"  },
  { family: "Lora",  weight: 700, file: "lora-latin-700-normal.woff"  },
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
      const buf = await readFile(join(FONT_DIR, s.file));
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
