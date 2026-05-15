"use client";

/**
 * RSVP buttons — Going / Maybe / Can't Go.
 *
 * Step 4 renders them; Step 5 wires the flow. For now, clicks
 * route to /invite/[token]/rsvp/[choice] which prompts the user
 * for their phone and starts the RSVP + profile capture flow.
 */

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

const OPTIONS = [
  { value: "going",   label: "Going",     emoji: "🎉" },
  { value: "maybe",   label: "Maybe",     emoji: "🤔" },
  { value: "cant_go", label: "Can't go",  emoji: "😞" },
] as const;

export default function RsvpButtons({
  tripId,
  shareToken,
}: {
  tripId: string;
  shareToken: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [, startTrans] = useTransition();

  function onTap(choice: (typeof OPTIONS)[number]["value"]) {
    // Visually commit immediately so the click "lands" — the
    // selected button switches to filled-green state before
    // navigation resolves. Wraps the actual push in a transition
    // so the rest of the page stays interactive while Next.js
    // routes to the RSVP flow.
    setPending(choice);
    startTrans(() => {
      router.push(`/invite/${shareToken}/rsvp?choice=${choice}`);
    });
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
