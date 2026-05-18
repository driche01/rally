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
import CreateTripButton from "@/lib/brand/create-trip-button";

export interface DashboardTrip {
  trip: Trip;
  isHost: boolean;
  isCohost: boolean;
  isInvitee: boolean;
  myStatus: RsvpStatus | null;
}

type Bucket = "upcoming" | "hosting" | "attending" | "past";

const BUCKETS: { id: Bucket; label: string }[] = [
  { id: "upcoming",  label: "Upcoming"  },
  { id: "hosting",   label: "Hosting"   },
  { id: "attending", label: "Attending" },
  { id: "past",      label: "Past"      },
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

  const today = todayISO();

  const counts = useMemo(() => bucketCounts(trips, today), [trips, today]);

  // Pending invites no longer have a dedicated bucket — they merge
  // into Upcoming. We still surface the count in the greeting line +
  // a red dot on the card itself so they don't get lost.
  const pendingInvites = useMemo(
    () => countPendingInvites(trips, today),
    [trips, today],
  );

  const visible = useMemo(
    () => filterByBucket(trips, bucket, today),
    [trips, bucket, today],
  );

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
          : counts.upcoming === 0 && pendingInvites === 0
            ? "Nothing on the calendar. Plan one below."
            : <>You have <strong className="text-ink">{counts.upcoming}</strong> upcoming trip{counts.upcoming === 1 ? "" : "s"}
                {pendingInvites > 0 && <> and <strong className="text-ink">{pendingInvites}</strong> invite{pendingInvites === 1 ? "" : "s"} waiting</>}.
              </>}
      </p>

      {/* ─── Filter pills ──────────────────────────────────────── */}
      {/* Sticky to the top of the scroll viewport so the pills stay
          accessible as the user scrolls through cards. The bg-cream/95
          backdrop-blur gives a clean separator over the cards behind
          it; the negative -mx + px combo bleeds the bar to the page
          edges while keeping content aligned to the gutter.
          2026-05-17: search bar dropped — for the typical user with
          <20 trips, scanning a 3-pill filter beats typing. */}
      {!isEmpty && (
        <div className="sticky top-0 z-20 -mx-5 sm:-mx-8 px-5 sm:px-8 pt-3 pb-3 mb-3 bg-cream/95 backdrop-blur-sm border-b border-line/60">
          <div className="-mx-5 sm:mx-0 px-5 sm:px-0 overflow-x-auto flex flex-nowrap items-center gap-2">
            {BUCKETS.map((b) => {
              const n = counts[b.id];
              const active = bucket === b.id;
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
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ─── Grid / empty state ────────────────────────────────── */}
      {isEmpty ? (
        <EmptyFirstTrip greetingName={greetingName} />
      ) : bucketEmpty ? (
        <BucketEmpty bucket={bucket} />
      ) : (
        <div className="grid gap-3 sm:gap-4 grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visible.map((t) => (
            <TripCard key={t.trip.id} dt={t} today={today} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────

function TripCard({ dt, today }: { dt: DashboardTrip; today: string }) {
  const { trip } = dt;
  const t = themeClass(trip.theme);
  const past = isPast(trip, today);
  const cancelled = !!trip.cancelled_at;
  const dateLabel = formatCardDate(trip);
  // Pending invite = on the respondent list, never RSVPed, not a
  // host or cohost. We tag these with a red dot in the top-right of
  // the card so they don't get lost in the merged Upcoming list now
  // that the dedicated Invites pill is gone.
  const pendingInvite =
    !past && !cancelled
    && dt.isInvitee
    && !dt.isHost && !dt.isCohost
    && (dt.myStatus === null || dt.myStatus === "invited");
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
      <div className="relative aspect-square rounded-[16px] sm:rounded-[22px] overflow-hidden border border-line bg-card transition-transform group-active:scale-[0.98]">
        {trip.cover_image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={trip.cover_image_url}
            alt=""
            className={"absolute inset-0 h-full w-full object-cover " + (past ? "saturate-50 opacity-90" : "")}
          />
        ) : (
          <div className={`absolute inset-0 ${t.cover} flex items-center justify-center px-2 sm:px-5`}>
            <span className={`font-display text-sm sm:text-2xl text-center leading-tight ${t.coverInk}`}>
              {trip.name}
            </span>
          </div>
        )}

        {/* Date pill (top-left). Stays tiny on mobile to suit the
            dense 2-col phone grid; scales up on sm+ where the cards
            are 2× wider and the pill needs to read at arm's length. */}
        {dateLabel && (
          <span className="absolute top-1.5 left-1.5 sm:top-3 sm:left-3 inline-flex items-center px-1.5 py-0.5 sm:px-2.5 sm:py-1 rounded-full bg-ink/70 text-cream text-[9px] sm:text-xs font-semibold backdrop-blur-sm leading-none whitespace-nowrap">
            {dateLabel}
          </span>
        )}

        {/* Pending-invite red dot (top-right). Notification-style cue
            that this trip needs your attention. Pairs with the gold
            "Invited" StatusChip in the bottom-right corner — together
            they replace the lost "Invites" pill + filter dot. */}
        {pendingInvite && (
          <span
            aria-hidden="true"
            className="absolute top-1.5 right-1.5 sm:top-3 sm:right-3 h-2.5 w-2.5 sm:h-3 sm:w-3 rounded-full bg-error ring-2 ring-cream"
          />
        )}

        {/* Status chip (bottom-right) */}
        <StatusChip dt={dt} past={past} cancelled={cancelled} />
      </div>

      <div className="mt-1.5 sm:mt-3 px-0.5 sm:px-1">
        <h3 className="font-display text-xs sm:text-lg text-ink leading-tight truncate">{trip.name}</h3>
        {trip.destination && (
          <p className="text-[10px] sm:text-sm text-muted truncate">{trip.destination}</p>
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

  // Cancelled wins regardless of date or role — the trip isn't
  // happening, that's the most important fact to surface.
  if (cancelled) {
    label = "Cancelled";
    cls = "bg-orange text-cream";
  } else if (dt.isHost) {
    label = past ? "Hosted" : "Hosting";
    cls = "bg-green text-cream";
  } else if (dt.isCohost) {
    label = past ? "Cohosted" : "Cohost";
    cls = "bg-green text-cream";
  } else if (past) {
    // For past trips with no host/cohost role, collapse all the
    // future-tense states into two clear past-tense labels so the
    // Past pill reads cleanly: did I go, or didn't I?
    //   "going"  → Attended (bg-green-soft, soft success)
    //   anything else → Invited (neutral, was-on-the-list but didn't make it)
    if (dt.myStatus === "going") {
      label = "Attended";
      cls = "bg-green-soft text-green";
    } else {
      label = "Invited";
      cls = "bg-card text-muted border border-line";
    }
  } else if (dt.myStatus === "going") {
    label = "👍 Going";
    cls = "bg-green text-cream";
  } else if (dt.myStatus === "maybe") {
    label = "🤔 Maybe";
    cls = "bg-gold text-ink";
  } else if (dt.myStatus === "cant_go") {
    label = "👎 Can't go";
    cls = "bg-card text-muted border border-line";
  } else if (dt.isInvitee) {
    label = "Invited";
    cls = "bg-gold text-ink";
  }
  if (!label) return null;

  return (
    <span
      className={
        "absolute bottom-1.5 right-1.5 sm:bottom-3 sm:right-3 inline-flex items-center px-1.5 py-0.5 sm:px-2.5 sm:py-1 rounded-full text-[9px] sm:text-xs font-bold leading-none whitespace-nowrap " +
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
      <CreateTripButton
        className="inline-flex h-12 px-6 items-center rounded-full bg-green text-cream font-bold hover:bg-green-2 active:scale-95 transition-transform"
      >
        + Start a trip
      </CreateTripButton>
    </div>
  );
}

function BucketEmpty({ bucket }: { bucket: Bucket }) {
  const copy: Record<Bucket, string> = {
    upcoming:  "Nothing on the calendar yet.",
    hosting:   "You're not hosting any trips yet. Start one to fix that.",
    attending: "Nothing on your schedule as a guest yet — RSVP yes to a trip and it'll show up here.",
    past:      "No past trips yet. They'll show up here once they wrap.",
  };
  return (
    <div className="py-10 text-center">
      <p className="text-muted text-sm mb-4">{copy[bucket]}</p>
      {(bucket === "hosting" || bucket === "upcoming") && (
        <CreateTripButton
          className="inline-flex h-10 px-5 items-center rounded-full bg-green text-cream font-bold text-sm hover:bg-green-2 active:scale-95 transition-transform"
        >
          + Start a trip
        </CreateTripButton>
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
        // Every future / undated, non-cancelled trip. Pending invites
        // merge here (with a red dot on the card) since the dedicated
        // Invites pill is gone.
        return !past && !cancelled;
      case "hosting":
        // Anything I host or cohost — past or future. The cards
        // themselves show "Went" / cancelled / etc. status so the
        // bucket doesn't need to gate on time.
        return dt.isHost || dt.isCohost;
      case "attending":
        // Future trips I've RSVPed "going" to as a guest. Excludes
        // host/cohost so the count doesn't double up with the Hosting
        // pill (planner-self-respondent has rsvp_status='going').
        return !past && !cancelled
          && dt.myStatus === "going"
          && !dt.isHost && !dt.isCohost;
      case "past":
        // Guest-perspective history: past or cancelled trips where I
        // wasn't the host/cohost. Past hosted trips live under
        // Hosting (no double-counting). The card chip differentiates:
        // "Attended" (went), "Invited" (didn't go), "Cancelled".
        return (past || cancelled) && !dt.isHost && !dt.isCohost;
    }
  });
}

function bucketCounts(trips: DashboardTrip[], today: string): Record<Bucket, number> {
  return {
    upcoming:  filterByBucket(trips, "upcoming",  today).length,
    hosting:   filterByBucket(trips, "hosting",   today).length,
    attending: filterByBucket(trips, "attending", today).length,
    past:      filterByBucket(trips, "past",      today).length,
  };
}

/** Pending invites — formerly its own bucket. Now folded into
 *  Upcoming but still useful as a top-of-page nudge ("you have N
 *  invites waiting"). */
function countPendingInvites(trips: DashboardTrip[], today: string): number {
  return trips.filter((dt) => {
    const past = isPast(dt.trip, today);
    const cancelled = !!dt.trip.cancelled_at;
    return !past && !cancelled && dt.isInvitee
      && !dt.isHost && !dt.isCohost
      && (dt.myStatus === null || dt.myStatus === "invited");
  }).length;
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
