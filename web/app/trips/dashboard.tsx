"use client";

/**
 * Client-side filter strip + grid for the trips index. Owns the
 * active-pill state and the search input. Pure presentation — the
 * server hands it the full union of trips and we slice in-memory.
 *
 * Buckets:
 *   - Upcoming        — trips with no end date OR end_date >= today,
 *                       and not cancelled. Excludes pure "invited"
 *                       (haven't yet responded) because those show up
 *                       under Invites first.
 *   - Invites         — visitor is on the respondent list with status
 *                       'invited' (never RSVPed).
 *   - Hosting         — isHost || isCohost.
 *   - Attended        — past trips (end_date < today) where the
 *                       visitor RSVPed 'going'.
 *   - All past        — past trips, regardless of RSVP.
 *   - Search          — text filter against name + destination.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import type { Trip, RsvpStatus } from "@shared/types";
import { themeClass } from "@/lib/themes";

export interface DashboardTrip {
  trip: Trip;
  isHost: boolean;
  isCohost: boolean;
  isInvitee: boolean;
  myStatus: RsvpStatus | null;
}

type Bucket = "upcoming" | "invites" | "hosting" | "attended" | "past";

const BUCKETS: { id: Bucket; label: string }[] = [
  { id: "upcoming", label: "Upcoming" },
  { id: "invites",  label: "Invites" },
  { id: "hosting",  label: "Hosting" },
  { id: "attended", label: "Attended" },
  { id: "past",     label: "All past" },
];

export default function TripsDashboard({
  greetingName,
  avatarUrl: _avatarUrl,
  trips,
}: {
  greetingName: string;
  avatarUrl: string | null;
  trips: DashboardTrip[];
}) {
  const [bucket, setBucket] = useState<Bucket>("upcoming");
  const [query, setQuery]   = useState("");

  const today = todayISO();

  const counts = useMemo(() => bucketCounts(trips, today), [trips, today]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = filterByBucket(trips, bucket, today);
    if (!q) return base;
    return base.filter((t) =>
      (t.trip.name + " " + (t.trip.destination ?? "")).toLowerCase().includes(q),
    );
  }, [trips, bucket, today, query]);

  const isEmpty = trips.length === 0;
  const bucketEmpty = !isEmpty && visible.length === 0;

  return (
    <div>
      {/* ─── Greeting ───────────────────────────────────────────── */}
      <h1 className="font-display text-4xl sm:text-5xl text-ink leading-tight mb-2">
        Welcome back, {greetingName}!
      </h1>
      <p className="text-muted mb-6">
        {isEmpty
          ? "You haven't planned a trip yet — kick one off below."
          : counts.upcoming === 0 && counts.invites === 0
            ? `Nothing on the calendar. You've got ${counts.past} past trip${counts.past === 1 ? "" : "s"} in the archive.`
            : <>You have <strong className="text-ink">{counts.upcoming}</strong> upcoming trip{counts.upcoming === 1 ? "" : "s"}
                {counts.invites > 0 && <> and <strong className="text-ink">{counts.invites}</strong> invite{counts.invites === 1 ? "" : "s"} waiting</>}.
              </>}
      </p>

      {/* ─── Filter pills + search ─────────────────────────────── */}
      {!isEmpty && (
        <div className="mb-6 grid gap-3 sm:flex sm:flex-wrap sm:items-center sm:gap-2">
          <SearchInput value={query} onChange={setQuery} />
          {/* Mobile: pills are a single horizontal-scrolling strip
              (no wrap) so "All past" never gets orphaned on its own
              line. Bleed the edges with -mx-5 sm:-mx-0 so the scroll
              touches the screen edges. sm+: revert to the existing
              flex-wrap layout where everything inlines next to the
              search box. */}
          <div className="-mx-5 sm:mx-0 px-5 sm:px-0 overflow-x-auto sm:overflow-visible flex flex-nowrap sm:flex-wrap sm:contents items-center gap-2">
            {BUCKETS.map((b) => {
              const n = counts[b.id];
              const active = bucket === b.id;
              const hasUnread = b.id === "invites" && n > 0;
              return (
                <button
                  key={b.id}
                  onClick={() => setBucket(b.id)}
                  className={
                    "relative h-9 px-4 rounded-full text-sm font-semibold transition-colors whitespace-nowrap flex-shrink-0 " +
                    (active
                      ? "bg-ink text-cream"
                      : "bg-card text-ink border border-line hover:border-green")
                  }
                >
                  {b.label}
                  {n > 0 && (
                    <span className={"ml-2 " + (active ? "opacity-80" : "text-muted")}>
                      {n}
                    </span>
                  )}
                  {hasUnread && !active && (
                    <span
                      aria-hidden="true"
                      className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-orange ring-2 ring-cream"
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Live search feedback — visible whenever a query is active so
          the user has a clear "yes, the filter applied" cue. Renders
          right above the grid; counts update as they type. (#3) */}
      {!isEmpty && query.trim() && (
        <p className="text-xs text-muted mb-3" aria-live="polite">
          Showing <strong className="text-ink">{visible.length}</strong> of{" "}
          {trips.length} trip{trips.length === 1 ? "" : "s"} for{" "}
          <strong className="text-ink">&ldquo;{query.trim()}&rdquo;</strong>
          {" — "}
          <button
            type="button"
            onClick={() => setQuery("")}
            className="underline underline-offset-2 hover:text-ink"
          >
            clear
          </button>
        </p>
      )}

      {/* ─── Grid / empty state ────────────────────────────────── */}
      {isEmpty ? (
        <EmptyFirstTrip greetingName={greetingName} />
      ) : bucketEmpty ? (
        <BucketEmpty bucket={bucket} query={query} />
      ) : (
        <div className="grid gap-5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visible.map((t) => (
            <TripCard key={t.trip.id} dt={t} today={today} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────

function SearchInput({
  value, onChange,
}: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative w-full sm:w-44">
      <span
        aria-hidden="true"
        className="absolute left-3 top-1/2 -translate-y-1/2 text-muted"
      >
        🔍
      </span>
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        // Enter dismisses the keyboard on mobile (matches the
        // mobile-app feel — the filter already applied while typing,
        // there's no submit to wait for).
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          }
        }}
        placeholder="Search trips"
        className="h-9 w-full pl-8 pr-3 rounded-full bg-card border border-line text-sm text-ink placeholder:text-muted focus:border-green focus:outline-none"
      />
    </div>
  );
}

function TripCard({ dt, today }: { dt: DashboardTrip; today: string }) {
  const { trip } = dt;
  const t = themeClass(trip.theme);
  const past = isPast(trip, today);
  const cancelled = !!trip.cancelled_at;
  const dateLabel = formatCardDate(trip);
  // Hosts + cohosts → planner dashboard; pure invitees → public
  // invite view (designed for them, no editing chrome).
  const href = (dt.isHost || dt.isCohost)
    ? `/trips/${trip.id}`
    : `/invite/${trip.share_token}`;

  return (
    <Link
      href={href}
      className="group block"
    >
      <div className="relative aspect-square rounded-[22px] overflow-hidden border border-line bg-card transition-transform group-active:scale-[0.98]">
        {trip.cover_image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={trip.cover_image_url}
            alt=""
            className={"absolute inset-0 h-full w-full object-cover " + (past ? "saturate-50 opacity-90" : "")}
          />
        ) : (
          <div className={`absolute inset-0 ${t.cover} flex items-center justify-center px-5`}>
            <span className={`font-display text-2xl text-center leading-tight ${t.coverInk}`}>
              {trip.name}
            </span>
          </div>
        )}

        {/* Date pill (top-left) */}
        {dateLabel && (
          <span className="absolute top-3 left-3 inline-flex items-center px-2.5 py-1 rounded-full bg-ink/70 text-cream text-xs font-semibold backdrop-blur-sm">
            {dateLabel}
          </span>
        )}

        {/* Status chip (bottom-right) */}
        <StatusChip dt={dt} past={past} cancelled={cancelled} />
      </div>

      <div className="mt-3 px-1">
        <h3 className="font-display text-lg text-ink leading-tight truncate">{trip.name}</h3>
        {trip.destination && (
          <p className="text-sm text-muted truncate">{trip.destination}</p>
        )}
      </div>
    </Link>
  );
}

function StatusChip({
  dt, past, cancelled,
}: { dt: DashboardTrip; past: boolean; cancelled: boolean }) {
  let label = "";
  let cls = "bg-ink/80 text-cream";

  if (cancelled) {
    label = "Cancelled";
    cls = "bg-orange text-cream";
  } else if (dt.isHost) {
    label = "Hosting";
    cls = "bg-green text-cream";
  } else if (dt.isCohost) {
    label = "Cohost";
    cls = "bg-green text-cream";
  } else if (dt.myStatus === "going") {
    label = past ? "Went" : "👍 Going";
    cls = "bg-green text-cream";
  } else if (dt.myStatus === "maybe") {
    label = "Maybe";
    cls = "bg-gold text-ink";
  } else if (dt.myStatus === "cant_go") {
    label = "Can't go";
    cls = "bg-card text-muted border border-line";
  } else if (dt.isInvitee) {
    label = "Invited";
    cls = "bg-gold text-ink";
  }
  if (!label) return null;

  return (
    <span
      className={
        "absolute bottom-3 right-3 inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold " +
        cls
      }
    >
      {label}
    </span>
  );
}

function EmptyFirstTrip({ greetingName }: { greetingName: string }) {
  return (
    <div className="mt-2 bg-card border border-line rounded-[28px] p-8 sm:p-12 text-center">
      <div className="mx-auto mb-5 h-14 w-14 rounded-full bg-green-soft text-green flex items-center justify-center text-2xl">
        ✦
      </div>
      <h2 className="font-display text-3xl text-ink mb-2">
        Start something, {greetingName}.
      </h2>
      <p className="text-muted max-w-md mx-auto mb-6">
        Pick a destination, lock the dates, and Rally handles the
        rest — invites, RSVPs, itinerary, lodging, the works.
      </p>
      <Link
        href="/trips/new"
        className="inline-flex h-12 px-6 items-center rounded-full bg-green text-cream font-bold hover:bg-green-2 active:scale-95 transition-transform"
      >
        + Start a trip
      </Link>
    </div>
  );
}

function BucketEmpty({ bucket, query }: { bucket: Bucket; query: string }) {
  if (query) {
    return (
      <p className="text-muted text-sm py-8">
        No trips matching <strong className="text-ink">&ldquo;{query}&rdquo;</strong> in this bucket.
      </p>
    );
  }
  const copy: Record<Bucket, string> = {
    upcoming: "Nothing on the calendar yet.",
    invites:  "No pending invites — you're all caught up.",
    hosting:  "You're not hosting any trips yet. Start one to fix that.",
    attended: "No past trips you've been to. The first one's the hardest.",
    past:     "No archived trips yet.",
  };
  return (
    <div className="py-10 text-center">
      <p className="text-muted text-sm mb-4">{copy[bucket]}</p>
      {(bucket === "hosting" || bucket === "upcoming") && (
        <Link
          href="/trips/new"
          className="inline-flex h-10 px-5 items-center rounded-full bg-green text-cream font-bold text-sm hover:bg-green-2 active:scale-95 transition-transform"
        >
          + Start a trip
        </Link>
      )}
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────

function todayISO(): string {
  // Local "today" — trips use date-only ISO strings, so we compare
  // by lexical date with the user's local timezone.
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function pad(n: number): string { return n < 10 ? `0${n}` : `${n}`; }

function isPast(trip: Trip, today: string): boolean {
  // If both dates are unknown the trip is "open" and never past.
  if (!trip.end_date) return false;
  return trip.end_date < today;
}

function filterByBucket(
  trips: DashboardTrip[], bucket: Bucket, today: string,
): DashboardTrip[] {
  return trips.filter((dt) => {
    const past = isPast(dt.trip, today);
    const cancelled = !!dt.trip.cancelled_at;
    switch (bucket) {
      case "upcoming":
        return !past && !cancelled;
      case "invites":
        // Pure "invited" = on the respondent list but never RSVPed.
        return !past && !cancelled && dt.isInvitee
          && (dt.myStatus === null || dt.myStatus === "invited")
          && !dt.isHost && !dt.isCohost;
      case "hosting":
        return dt.isHost || dt.isCohost;
      case "attended":
        return past && dt.myStatus === "going";
      case "past":
        return past;
    }
  });
}

function bucketCounts(trips: DashboardTrip[], today: string): Record<Bucket, number> {
  return {
    upcoming: filterByBucket(trips, "upcoming", today).length,
    invites:  filterByBucket(trips, "invites",  today).length,
    hosting:  filterByBucket(trips, "hosting",  today).length,
    attended: filterByBucket(trips, "attended", today).length,
    past:     filterByBucket(trips, "past",     today).length,
  };
}

function formatCardDate(trip: Trip): string {
  if (!trip.start_date && !trip.end_date) return "";
  const fmt = (iso: string) =>
    new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
      month: "short", day: "numeric",
    });
  if (trip.start_date && trip.end_date) {
    const startY = new Date(trip.start_date + "T00:00:00").getFullYear();
    const nowY = new Date().getFullYear();
    const yearSuffix = startY === nowY ? "" : `, ${startY}`;
    return `${fmt(trip.start_date)} → ${fmt(trip.end_date)}${yearSuffix}`;
  }
  if (trip.start_date) return fmt(trip.start_date);
  if (trip.end_date)   return `Until ${fmt(trip.end_date)}`;
  return "";
}
