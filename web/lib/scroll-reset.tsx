"use client";

/**
 * ScrollResetOnMount — forces the viewport to the top of the page
 * on initial mount. Drop into any server-rendered route layout
 * where the App Router's default scroll-on-navigation is missing
 * the mark (commonly: iOS Safari preserving the prior page's
 * scroll position when the new page has tall content that hasn't
 * laid out yet).
 *
 * Renders nothing. Runs once per mount. No-op on subsequent
 * re-renders.
 */

import { useEffect } from "react";

export default function ScrollResetOnMount() {
  useEffect(() => {
    // Synchronous on the first paint frame so the user never sees a
    // momentary scroll position from the previous route. `instant`
    // because any animation here would be a distraction, not a
    // delight.
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, []);
  return null;
}
