"use client";

/**
 * RSVP buttons — Going / Maybe / Can't Go.
 *
 * Step 4 renders them; Step 5 wires the flow. For now, clicks
 * route to /invite/[token]/rsvp/[choice] which prompts the user
 * for their phone and starts the RSVP + profile capture flow.
 */

import { useRouter } from "next/navigation";
import { useState } from "react";

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
  const [busy, setBusy] = useState<string | null>(null);

  function onTap(choice: (typeof OPTIONS)[number]["value"]) {
    setBusy(choice);
    router.push(`/invite/${shareToken}/rsvp?choice=${choice}`);
  }

  return (
    <div className="grid grid-cols-3 gap-2 sm:gap-3">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          onClick={() => onTap(o.value)}
          disabled={busy !== null}
          className="flex flex-col items-center justify-center gap-1 py-4 rounded-[18px] bg-card border border-line hover:border-green hover:bg-green-soft/30 disabled:opacity-50 transition-colors"
        >
          <span className="text-2xl leading-none" aria-hidden="true">
            {o.emoji}
          </span>
          <span className="text-sm font-semibold text-ink">{o.label}</span>
        </button>
      ))}
    </div>
  );
}
