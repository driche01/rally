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
    const editing  = pending !== null;
    // Whole confirmation chip is the CTA — tapping re-opens the RSVP
    // flow so the respondent can change their answer (or update their
    // profile/notes). The three smaller per-option pills below were
    // retired here on 2026-05-19 in favor of this single-tap target;
    // the guiding caption inside the chip ("Select to edit your RSVP")
    // signals that the chip is interactive.
    return (
      <button
        type="button"
        onClick={() => onTap(confirmed)}
        disabled={editing}
        aria-live="polite"
        aria-label={`Your RSVP: ${CONFIRM_LABELS[confirmed as Exclude<RsvpStatus, "invited">]} — tap to edit`}
        className={
          "w-full flex items-center justify-between gap-3 py-4 px-4 rounded-[18px] border shadow-md text-left transition-colors disabled:cursor-not-allowed " +
          (editing
            ? "bg-green-2 text-cream border-green-2"
            : "bg-green text-cream border-green hover:bg-green-2")
        }
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
            <p className="text-[11px] opacity-80 leading-tight mt-0.5">
              {editing ? "Opening…" : "Select to edit your RSVP"}
            </p>
          </div>
        </div>
        <span aria-hidden="true" className="text-cream/90 text-xl leading-none flex-shrink-0">
          {editing ? "…" : "✎"}
        </span>
      </button>
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
