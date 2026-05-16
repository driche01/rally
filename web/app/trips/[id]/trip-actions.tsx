"use client";

/**
 * TripActions — the host-facing action row that lives under the
 * cover image in the trip layout (left column, lg+; stacked above
 * tabs on smaller viewports).
 *
 * Three primary CTAs stay visible in a single line:
 *   • Invite people →
 *   • Copy share link
 *   • Send blast →
 *
 * Two secondary actions move to an overflow menu (⋯):
 *   • Clone trip
 *   • Cancel trip (hidden once trip.cancelled_at is set)
 *
 * Owns the state for the invite + blast modals and the cloning +
 * cancelling network flows. Modals render alongside their trigger.
 *
 * Gated to canEdit=true at the layout level; non-managing viewers
 * don't see the row.
 */

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Respondent, Trip } from "@shared/types";
import { themeClass } from "@/lib/themes";
import InviteModal from "./invite-modal";
import BlastComposer from "./blast-composer";

export default function TripActions({
  trip, respondents, inviteUrl,
}: {
  trip: Pick<Trip, "id" | "name" | "theme" | "cancelled_at">;
  respondents: Respondent[];
  inviteUrl: string;
}) {
  const router = useRouter();
  const [, startTrans] = useTransition();
  const [showInvite, setShowInvite] = useState(false);
  const [showBlast, setShowBlast]   = useState(false);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [copied, setCopied]   = useState(false);
  const [cloning, setCloning] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const overflowRef = useRef<HTMLDivElement>(null);

  const t = themeClass(trip.theme);
  const cancelled = Boolean(trip.cancelled_at);

  // Click-outside to close overflow menu.
  useEffect(() => {
    if (!overflowOpen) return;
    function onDocClick(e: MouseEvent) {
      if (overflowRef.current && !overflowRef.current.contains(e.target as Node)) {
        setOverflowOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [overflowOpen]);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy this link:", inviteUrl);
    }
  }

  async function clone() {
    setOverflowOpen(false);
    if (!confirm("Clone this trip? You'll get a fresh draft with the same name, theme, destination, and budget — but no invitees, itinerary, lodging, travel, meals, or shopping.")) return;
    setCloning(true);
    try {
      const res = await fetch(`/api/trips/${trip.id}/clone`, { method: "POST" });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        alert(`Clone failed: ${body?.error?.code ?? res.status}`);
        return;
      }
      startTrans(() => router.push(`/trips/${body.data.trip.id}`));
    } catch {
      alert("Couldn't reach Rally. Try again.");
    } finally {
      setCloning(false);
    }
  }

  async function cancelTrip() {
    setOverflowOpen(false);
    const note =
      "Cancel this trip? This will:\n" +
      "• Notify every guest via SMS\n" +
      "• Lock the trip page (no new RSVPs or activity)\n" +
      "• Post a system entry to the activity feed\n\n" +
      "This cannot be undone.";
    if (!confirm(note)) return;
    setCancelling(true);
    try {
      const res = await fetch(`/api/trips/${trip.id}/cancel`, { method: "POST" });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        alert(`Cancel failed: ${body?.error?.code ?? res.status}`);
        return;
      }
      const sms = body.data?.sms;
      alert(
        `Trip cancelled. SMS: ${sms?.sent ?? 0} sent` +
          (sms?.failed ? `, ${sms.failed} failed` : "") +
          (sms?.suppressed_opted_out ? `, ${sms.suppressed_opted_out} suppressed (opted out)` : ""),
      );
      router.refresh();
    } catch {
      alert("Couldn't reach Rally. Try again.");
    } finally {
      setCancelling(false);
    }
  }

  return (
    <>
      {/* Mobile: stack vertically so each label fits without ellipses.
          sm+: revert to the single-row layout (#6 in the mobile QA
          batch). Each primary action gets a lucide-style icon so the
          mobile stack still reads visually at a glance. */}
      <div className="grid grid-cols-1 sm:flex sm:items-center gap-2 sm:flex-nowrap">
        <button
          onClick={() => setShowInvite(true)}
          disabled={cancelled}
          className="h-11 px-4 rounded-full bg-green text-cream font-bold text-sm hover:bg-green-2 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2 sm:flex-1 sm:min-w-0"
        >
          <IconUserPlus className="h-4 w-4" />
          <span>Invite people</span>
        </button>
        <button
          onClick={copyLink}
          className={`h-11 px-3 rounded-full ${t.surface} text-ink border ${t.surfaceBorder} hover:border-green text-sm inline-flex items-center justify-center gap-2 sm:flex-1 sm:min-w-0`}
        >
          <IconLink className="h-4 w-4" />
          <span>{copied ? "Copied" : "Copy share link"}</span>
        </button>
        <button
          onClick={() => setShowBlast(true)}
          disabled={cancelled}
          className={`h-11 px-3 rounded-full ${t.surface} text-ink border ${t.surfaceBorder} hover:border-green text-sm disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2 sm:flex-1 sm:min-w-0`}
        >
          <IconSend className="h-4 w-4" />
          <span>Send blast</span>
        </button>

        {/* Overflow menu — Clone + Cancel. */}
        <div className="relative flex-shrink-0 self-end sm:self-auto" ref={overflowRef}>
          <button
            onClick={() => setOverflowOpen((v) => !v)}
            aria-label="More actions"
            aria-haspopup="menu"
            aria-expanded={overflowOpen}
            className={`h-11 w-11 rounded-full ${t.surface} text-ink border ${t.surfaceBorder} hover:border-green flex items-center justify-center text-lg font-bold leading-none`}
          >
            ⋯
          </button>
          {overflowOpen && (
            <div
              role="menu"
              className="absolute right-0 top-full mt-2 min-w-[180px] bg-card border border-line rounded-2xl shadow-lg z-30 overflow-hidden"
            >
              <button
                role="menuitem"
                onClick={clone}
                disabled={cloning}
                title="Duplicate trip metadata + cohosts. No invitees / itinerary / lodging / etc. carry over."
                className="w-full text-left px-4 py-2.5 text-sm text-ink hover:bg-green-soft disabled:opacity-50"
              >
                {cloning ? "Cloning…" : "Clone trip"}
              </button>
              {!cancelled && (
                <button
                  role="menuitem"
                  onClick={cancelTrip}
                  disabled={cancelling}
                  className="w-full text-left px-4 py-2.5 text-sm text-orange hover:bg-orange/10 disabled:opacity-50 border-t border-line"
                >
                  {cancelling ? "Cancelling…" : "Cancel trip"}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {showInvite && (
        <InviteModal
          tripId={trip.id}
          tripName={trip.name}
          shareLink={inviteUrl}
          onClose={() => setShowInvite(false)}
          onSent={() => {
            setShowInvite(false);
            router.refresh();
          }}
        />
      )}

      {showBlast && (
        <BlastComposer
          tripId={trip.id}
          tripName={trip.name}
          respondents={respondents}
          onClose={() => setShowBlast(false)}
        />
      )}
    </>
  );
}

// ─── Inline SVG icons (lucide-style, currentColor) ──────────────
// Inlined rather than pulling lucide-react in as a dep — three
// 24×24 glyphs aren't worth a runtime package.

function IconUserPlus({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      className={className} aria-hidden="true"
    >
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <line x1="19" y1="8" x2="19" y2="14" />
      <line x1="22" y1="11" x2="16" y2="11" />
    </svg>
  );
}

function IconLink({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      className={className} aria-hidden="true"
    >
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

function IconSend({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      className={className} aria-hidden="true"
    >
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}
