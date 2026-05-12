"use client";

/**
 * TabNav — dashboard top-tab navigation. Per BUILD_QUESTIONS Q16.
 * Route-segment tabs: each tab is /trips/[id]/<segment>. Overview
 * is the bare /trips/[id] route.
 *
 * Phase B Step 4 ships Overview + Itinerary as functional tabs.
 * The remaining four (Lodging, Travel, Meals, Shopping) appear in
 * the nav with a "soon" pill — they'll be wired in Steps 5–8.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";

interface TabDef {
  segment: string;       // empty string = Overview (no sub-segment)
  label: string;
  ready: boolean;
}

const TABS: TabDef[] = [
  { segment: "",           label: "Overview",  ready: true  },
  { segment: "itinerary",  label: "Itinerary", ready: true  },
  { segment: "lodging",    label: "Lodging",   ready: true  },
  { segment: "travel",     label: "Travel",    ready: true  },
  { segment: "meals",      label: "Meals",     ready: true  },
  { segment: "shopping",   label: "Shopping",  ready: false },
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
          if (!t.ready) {
            return (
              <li key={t.segment || "overview"}>
                <span
                  className="h-9 px-4 inline-flex items-center gap-1 rounded-full text-sm text-muted/70 cursor-not-allowed"
                  title="Wires up in a later Phase B step"
                >
                  {t.label}
                  <span className="text-[10px] uppercase tracking-widest font-bold text-muted/60 ml-1">
                    soon
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
