// Web doesn't go through `expo-font`'s loader anymore — the four Inter
// weights are declared as @font-face rules in `global.css` pointing at
// the self-hosted `/fonts/inter-latin.woff2` (single variable-axis
// file, ~48 KB total). `font-display: swap` means the page renders
// immediately in the fallback stack while the font streams.
//
// Skipping the loader here keeps `@expo-google-fonts/inter` out of the
// web bundle entirely — no more 18-weight TTF dump in `dist/assets/`.
export function useAppFonts() {
  return true;
}
