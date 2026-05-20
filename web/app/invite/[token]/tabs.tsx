"use client";

/**
 * RespondentTabNav — visual mirror of the planner TabNav, rendered on
 * every respondent route under /invite/[token]/.
 *
 * Alpha (2026-05-19): Overview + Travel are interactive for
 * respondents. Itinerary/Lodging/Meals/Shopping render as disabled
 * "· soon" chips because the surfaces themselves aren't built yet —
 * NOT because respondents are restricted from them. The intent is
 * that every tab is respondent-accessible. Once each tab ships:
 *
 *   1. Build a respondent route at /invite/[token]/<segment>/page.tsx
 *      (mirroring the /invite/[token]/travel/page.tsx pattern —
 *      share-token gated, render the planner's tab component with
 *      `canManage={false}`).
 *   2. Remove `disabled: true` from the corresponding row in the
 *      TABS array below.
 *
 * Active state is derived from the URL: anything ending in `/travel`
 * gets the Travel pill highlighted, otherwise Overview wins.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";

interface TabDef {
  segment: string;       // "" = Overview (the bare /invite/[token])
  label: string;
  disabled?: boolean;
}

const TABS: TabDef[] = [
  { segment: "",           label: "Overview"                 },
  { segment: "travel",     label: "Travel"                   },
  { segment: "itinerary",  label: "Itinerary", disabled: true },
  { segment: "lodging",    label: "Lodging",   disabled: true },
  { segment: "meals",      label: "Meals",     disabled: true },
  { segment: "shopping",   label: "Shopping",  disabled: true },
];

export default function RespondentTabNav({ token }: { token: string }) {
  const pathname = usePathname();
  const basePath = `/invite/${token}`;
  // Last segment after the token = active tab (or "" for Overview).
  const currentSeg = pathname === basePath
    ? ""
    : pathname.slice(basePath.length + 1).split("/")[0] ?? "";

  return (
    <nav className="mt-5 mb-6 -mx-6 px-6 overflow-x-auto" aria-label="Trip tabs">
      <ul className="flex items-center gap-1 min-w-max">
        {TABS.map((t) => {
          const active = t.segment === currentSeg;
          const href   = t.segment === "" ? basePath : `${basePath}/${t.segment}`;

          if (t.disabled) {
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
                aria-current={active ? "page" : undefined}
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
