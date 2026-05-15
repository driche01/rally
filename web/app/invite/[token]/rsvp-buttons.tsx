"use client";

/**
 * RSVP buttons — Going / Maybe / Can't Go.
 *
 * Two modes:
 *
 *   - Fresh (no `myStatus`): three side-by-side options. Tapping
 *     pushes to /invite/[token]/rsvp?choice=… and the chosen button
 *     fills green so the click "lands" before the route loads.
 *
 *   - Returning (`myStatus` is set): the matching option renders
 *     filled-green as a confirmation chip, the other two stay
 *     available as a quick swap. A small "Change RSVP" footer link
 *     opens the full RSVP flow if they want to edit details (note,
 *     profile, etc.).
 *
 * Identity comes from the `rally_session_token` cookie that
 * /api/invite/[token]/rsvp sets on successful RSVP. The page-level
 * component does the lookup and passes the matched status + first
 * name in.
 */

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { RsvpStatus } from "@shared/types";

const OPTIONS = [
  { value: "going",   label: "Going",     emoji: "🎉" },
  { value: "maybe",   label: "Maybe",     emoji: "🤔" },
  { value: "cant_go", label: "Can't go",  emoji: "😞" },
] as const;

const CONFIRM_LABELS: Record<Exclude<RsvpStatus, "invited">, string> = {
  going:   "You're going!",
  maybe:   "You're a maybe.",
  cant_go: "You can't make it.",
};

export default function RsvpButtons({
  tripId: _tripId, // reserved for the eventual inline PATCH-by-token path
  shareToken,
  myStatus,
  myFirstName,
}: {
  tripId: string;
  shareToken: string;
  myStatus?: RsvpStatus | null;
  myFirstName?: string | null;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [, startTrans] = useTransition();
  // `invited` (= seeded by the planner, no real reply yet) shouldn't
  // count as a confirmation — show the fresh 3-button state instead.
  const confirmed = myStatus && myStatus !== "invited" ? myStatus : null;

  function onTap(choice: (typeof OPTIONS)[number]["value"]) {
    // Visually commit immediately so the click "lands" — the
    // selected button switches to filled-green state before
    // navigation resolves.
    setPending(choice);
    startTrans(() => {
      router.push(`/invite/${shareToken}/rsvp?choice=${choice}`);
    });
  }

  if (confirmed) {
    const confirmedOpt = OPTIONS.find((o) => o.value === confirmed)!;
    const greeting = myFirstName ? `${myFirstName}, ` : "";
    return (
      <div className="grid gap-2">
        <div
          aria-live="polite"
          className="flex items-center justify-between gap-3 py-4 px-4 rounded-[18px] bg-green text-cream border border-green shadow-md"
        >
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-2xl leading-none" aria-hidden="true">
              {confirmedOpt.emoji}
            </span>
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-widest font-bold opacity-80 leading-none mb-0.5">
                Your RSVP
              </p>
              <p className="font-bold text-base leading-tight truncate">
                {greeting}{CONFIRM_LABELS[confirmed as Exclude<RsvpStatus, "invited">]}
              </p>
            </div>
          </div>
          <span aria-hidden="true" className="text-cream/90 text-xl leading-none">✓</span>
        </div>
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          {OPTIONS.map((o) => {
            const isCurrent = o.value === confirmed;
            const isPending = pending === o.value;
            return (
              <button
                key={o.value}
                onClick={() => onTap(o.value)}
                disabled={pending !== null}
                className={
                  "flex items-center justify-center gap-1.5 py-2.5 rounded-full border text-xs font-semibold transition-colors disabled:cursor-not-allowed " +
                  (isPending
                    ? "bg-green text-cream border-green"
                    : isCurrent
                      ? "bg-green-soft/40 border-green text-ink"
                      : "bg-card border-line text-ink hover:border-green")
                }
              >
                <span aria-hidden="true" className="text-sm">{o.emoji}</span>
                <span>{isCurrent ? "Change" : o.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-3 gap-2 sm:gap-3">
      {OPTIONS.map((o) => {
        const isPending = pending === o.value;
        const dimOthers = pending !== null && !isPending;
        return (
          <button
            key={o.value}
            onClick={() => onTap(o.value)}
            disabled={pending !== null}
            className={
              "flex flex-col items-center justify-center gap-1 py-4 rounded-[18px] border transition-colors disabled:cursor-not-allowed " +
              (isPending
                ? "bg-green text-cream border-green shadow-md"
                : dimOthers
                  ? "bg-card border-line opacity-40"
                  : "bg-card border-line hover:border-green hover:bg-green-soft/30")
            }
          >
            <span className="text-2xl leading-none" aria-hidden="true">
              {o.emoji}
            </span>
            <span className={`text-sm font-semibold ${isPending ? "text-cream" : "text-ink"}`}>
              {o.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
