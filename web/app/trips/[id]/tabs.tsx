"use client";

/**
 * TabNav — dashboard top-tab navigation. Per BUILD_QUESTIONS Q16.
 * Route-segment tabs: each tab is /trips/[id]/<segment>. Overview
 * is the bare /trips/[id] route.
 *
 * All six tabs (Overview · Itinerary · Lodging · Travel · Meals ·
 * Shopping) are live as of Phase B; previous "soon" gating was
 * removed once Steps 5–8 shipped.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";

interface TabDef {
  segment: string;       // empty string = Overview (no sub-segment)
  label: string;
}

const TABS: TabDef[] = [
  { segment: "",           label: "Overview"  },
  { segment: "itinerary",  label: "Itinerary" },
  { segment: "lodging",    label: "Lodging"   },
  { segment: "travel",     label: "Travel"    },
  { segment: "meals",      label: "Meals"     },
  { segment: "shopping",   label: "Shopping"  },
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
