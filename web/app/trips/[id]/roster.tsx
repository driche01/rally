"use client";

/**
 * Roster — host-only view of all respondents on a trip.
 * Filter by status, search by name/phone, override RSVP per row.
 * Build guide §6 Step 7.
 */

import { useState, useMemo } from "react";
import type { Respondent, RsvpStatus } from "@shared/types";

type Filter = "all" | RsvpStatus;
const FILTERS: { value: Filter; label: string }[] = [
  { value: "all",     label: "All" },
  { value: "going",   label: "Going" },
  { value: "maybe",   label: "Maybe" },
  { value: "invited", label: "Invited" },
  { value: "cant_go", label: "Can't go" },
];

const STATUS_PRETTY: Record<RsvpStatus, string> = {
  going:   "Going",
  maybe:   "Maybe",
  invited: "Invited",
  cant_go: "Can't go",
};

type SortKey = "name_asc" | "name_desc" | "recent" | "status";
const SORT_LABELS: Record<SortKey, string> = {
  name_asc:  "Name (A→Z)",
  name_desc: "Name (Z→A)",
  recent:    "Most recent",
  status:    "Status",
};
const STATUS_ORDER: Record<RsvpStatus, number> = {
  going: 0, maybe: 1, invited: 2, cant_go: 3,
};

export default function Roster({
  respondents,
  onOverride,
}: {
  respondents: Respondent[];
  onOverride: (respondent_id: string, rsvp_status: RsvpStatus) => void | Promise<void>;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [sort, setSort]   = useState<SortKey>("status");
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = respondents.filter((r) => {
      const status = (r.rsvp_status ?? "invited") as RsvpStatus;
      if (filter !== "all" && status !== filter) return false;
      if (!q) return true;
      return (
        r.name.toLowerCase().includes(q) ||
        (r.phone?.toLowerCase().includes(q) ?? false) ||
        (r.email?.toLowerCase().includes(q) ?? false)
      );
    });
    return filtered.sort((a, b) => {
      switch (sort) {
        case "name_asc":  return a.name.localeCompare(b.name);
        case "name_desc": return b.name.localeCompare(a.name);
        case "recent": {
          const ts = (r: Respondent) =>
            new Date(r.rsvp_status_updated_at ?? r.created_at).getTime();
          return ts(b) - ts(a);
        }
        case "status": {
          const sa = STATUS_ORDER[(a.rsvp_status ?? "invited") as RsvpStatus];
          const sb = STATUS_ORDER[(b.rsvp_status ?? "invited") as RsvpStatus];
          return sa - sb || a.name.localeCompare(b.name);
        }
      }
    });
  }, [respondents, filter, query, sort]);

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-display text-2xl text-ink">
          Roster · {respondents.length}
        </h2>
        <p className="text-xs uppercase tracking-widest text-muted font-semibold">
          Host only
        </p>
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={
              filter === f.value
                ? "h-9 px-4 rounded-full bg-green-soft text-green border border-green font-semibold text-sm"
                : "h-9 px-4 rounded-full bg-card text-ink border border-line text-sm hover:border-green-soft"
            }
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="flex gap-2 mb-4 flex-wrap">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name or phone…"
          className="flex-1 min-w-[180px] h-11 rounded-full border border-line bg-card px-4 text-sm text-ink placeholder:text-muted focus:border-green focus:outline-none"
        />
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className="h-11 px-3 rounded-full border border-line bg-card text-sm text-ink"
          aria-label="Sort"
        >
          {Object.entries(SORT_LABELS).map(([key, label]) => (
            <option key={key} value={key}>Sort: {label}</option>
          ))}
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="bg-card border border-line rounded-2xl p-6 text-center">
          <p className="text-muted text-sm">
            {respondents.length === 0
              ? "No one's been invited yet. Tap “Invite people” to send your first wave."
              : "Nobody matches that filter."}
          </p>
        </div>
      ) : (
        <ul className="grid gap-2">
          {filtered.map((r) => {
            const status = (r.rsvp_status ?? "invited") as RsvpStatus;
            const isMenuOpen = openMenuId === r.id;
            return (
              <li
                key={r.id}
                className="bg-card border border-line rounded-2xl p-3 sm:p-4 flex items-center gap-3"
              >
                <div className="h-10 w-10 rounded-full bg-green-soft text-green flex items-center justify-center font-bold flex-shrink-0">
                  {r.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-ink font-semibold truncate">
                    {r.name}
                    {r.is_planner && (
                      <span className="ml-2 text-xs uppercase tracking-widest text-gold font-bold">
                        host
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted truncate">
                    {r.phone ?? r.email ?? "—"}
                  </p>
                </div>
                <div className="relative">
                  <button
                    onClick={() => setOpenMenuId(isMenuOpen ? null : r.id)}
                    className={
                      "h-9 px-3 rounded-full text-xs font-semibold border " +
                      statusChipCls(status)
                    }
                    aria-label="Override RSVP"
                  >
                    {STATUS_PRETTY[status]} ▾
                  </button>
                  {isMenuOpen && (
                    <div
                      className="absolute right-0 mt-2 w-44 bg-card border border-line rounded-2xl shadow-md z-10 overflow-hidden"
                      role="menu"
                    >
                      {(["going","maybe","invited","cant_go"] as RsvpStatus[]).map((s) => (
                        <button
                          key={s}
                          role="menuitem"
                          onClick={async () => {
                            setOpenMenuId(null);
                            if (s !== status) await onOverride(r.id, s);
                          }}
                          className={
                            "w-full text-left px-4 py-2 text-sm hover:bg-green-soft " +
                            (s === status ? "text-green font-semibold" : "text-ink")
                          }
                        >
                          Set to {STATUS_PRETTY[s]}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function statusChipCls(s: RsvpStatus): string {
  switch (s) {
    case "going":   return "bg-green-soft text-green border-green";
    case "maybe":   return "bg-cream-2 text-ink border-line";
    case "invited": return "bg-card text-muted border-line";
    case "cant_go": return "bg-cream-2 text-muted border-line";
  }
}
