"use client";

/**
 * useBodyScrollLock — when a modal mounts, freeze the body so the
 * page behind it doesn't scroll under finger swipes / mousewheel.
 *
 * Restores the prior overflow value on unmount, so nested modals
 * still work: the inner modal restores to "hidden" (set by the
 * outer modal), the outer one restores to "" (the page default).
 *
 * Plain useEffect — no portal, no body-scroll-lock library
 * dependency. Sufficient for Rally's modal patterns (single modal
 * at a time, no iOS-Safari rubber-band concerns since the modals
 * themselves are scrollable containers with max-h-[92dvh]).
 */

import { useEffect } from "react";

export function useBodyScrollLock(active = true) {
  useEffect(() => {
    if (!active) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [active]);
}
