"use client";

/**
 * TabNav — dashboard top-tab navigation. Per BUILD_QUESTIONS Q16.
 * Route-segment tabs: each tab is /trips/[id]/<segment>. Overview
 * is the bare /trips/[id] route.
 *
 * Alpha (2026-05-16): only Overview + Travel are live. Itinerary,
 * Lodging, Meals, and Shopping are visible but disabled, with a
 * "coming soon" label so planners know the surface is in flight.
 * The route handlers still exist (and still render) — we just
 * don't link to them from the nav. Toggle each tab back on by
 * flipping `disabled: false` in the TABS array.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";

interface TabDef {
  segment: string;       // empty string = Overview (no sub-segment)
  label: string;
  disabled?: boolean;    // true → render as a greyed-out, non-clickable chip
}

const TABS: TabDef[] = [
  { segment: "",           label: "Overview"                          },
  { segment: "travel",     label: "Travel"                            },
  { segment: "itinerary",  label: "Itinerary",  disabled: true },
  { segment: "lodging",    label: "Lodging",    disabled: true },
  { segment: "meals",      label: "Meals",      disabled: true },
  { segment: "shopping",   label: "Shopping",   disabled: true },
];

export default function TabNav({ tripId }: { tripId: string }) {
  const pathname = usePathname();
  const basePath = `/trips/${tripId}`;
  const currentSeg = pathname === basePath ? "" : pathname.slice(basePath.length + 1).split("/")[0] ?? "";

  return (
    <nav className="mt-5 mb-6 -mx-6 px-6 overflow-x-auto" aria-label="Trip tabs">
      <ul className="flex items-center gap-1 min-w-max">
        {TABS.map((t) => {
          const active = t.segment === currentSeg;
          const href = t.segment === "" ? basePath : `${basePath}/${t.segment}`;

          if (t.disabled) {
            // Greyed-out chip — no <Link>, no hover state. "coming
            // soon" is appended on sm+ so the nav stays scrollable on
            // narrow phones; on mobile the label shrinks back to just
            // the tab name to keep the row from blowing past the
            // viewport.
            return (
              <li key={t.segment || "overview"}>
                <span
                  className="h-9 px-4 inline-flex items-center rounded-full text-sm font-semibold text-ink/40 bg-card/40 border border-line/60 cursor-not-allowed whitespace-nowrap gap-1"
                  aria-disabled="true"
                  title="Coming soon to Rally"
                >
                  {t.label}
                  <span className="hidden sm:inline text-[10px] uppercase tracking-widest text-ink/30 ml-1">
                    · soon
                  </span>
                </span>
              </li>
            );
          }

          return (
            <li key={t.segment || "overview"}>
              <Link
                href={href}
                className={
                  "h-9 px-4 inline-flex items-center rounded-full text-sm font-semibold transition-colors " +
                  (active
                    ? "bg-green text-cream"
                    : "text-ink/80 hover:text-ink hover:bg-card")
                }
              >
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
