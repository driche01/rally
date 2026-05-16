"use client";

/**
 * StatModal — opens when a planner taps one of the "Going / Maybe /
 * Invited / Can't go" stat cards on the trip dashboard. Shows the
 * roster of respondents in that status with two affordances per row:
 *
 *   - Override their RSVP — dropdown (Going · Maybe · Invited · Can't go).
 *     Calls the parent's onOverride which optimistic-flips locally
 *     then PATCHes /api/trips/[id]/memberships.
 *   - Footer "Send nudge to this group" CTA — opens the BlastComposer
 *     with the segment pre-locked to this status.
 *
 * Per-individual nudge (#8b) is the next planned add — needs a server-
 * side extension to /api/trips/[id]/blasts to accept a
 * recipient_respondent_id list. Tracked as the follow-up; group-
 * nudge ships now since it covers the most-common planner intent.
 *
 * Mobile-first: full-width sheet on phones, max-w-lg centered on sm+.
 */

import { useEffect, useState } from "react";
import type { Respondent, RsvpStatus } from "@shared/types";

const STATUS_LABELS: Record<RsvpStatus, string> = {
  going:   "Going",
  maybe:   "Maybe",
  invited: "Invited",
  cant_go: "Can't go",
};

interface Props {
  /** Which bucket this modal is showing — drives header label + the
   *  segment pre-fill on the nudge CTA. */
  status: RsvpStatus;
  /** Already filtered to just this status by the parent. */
  respondents: Respondent[];
  onClose: () => void;
  /** Reuses the parent's existing onOverride pipeline. */
  onOverride: (respondentId: string, newStatus: RsvpStatus) => Promise<void> | void;
  /** Click "Send nudge" → parent opens the blast composer pre-locked
   *  to this segment. */
  onSendNudge: () => void;
  /** Planner = sees override + nudge controls. Non-planner viewers
   *  (cohost reading-only, respondent peeking at roster) get a
   *  read-only list. */
  canManage: boolean;
}

export default function StatModal({
  status, respondents, onClose, onOverride, onSendNudge, canManage,
}: Props) {
  const [pendingOverride, setPendingOverride] = useState<string | null>(null);

  // Esc closes; lock body scroll.
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  async function handleOverride(rId: string, next: RsvpStatus) {
    setPendingOverride(rId);
    try { await onOverride(rId, next); }
    finally { setPendingOverride(null); }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-6"
      role="dialog" aria-modal="true" aria-labelledby="stat-modal-title"
      onClick={onClose}
    >
      <div
        className="bg-cream w-full sm:max-w-lg sm:rounded-[28px] rounded-t-[28px] max-h-[92dvh] overflow-hidden shadow-lg flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-line flex items-center justify-between">
          <button
            onClick={onClose}
            aria-label="Close"
            className="h-9 w-9 rounded-full hover:bg-line/40 text-ink text-xl leading-none -ml-2"
          >×</button>
          <div className="text-center">
            <p id="stat-modal-title" className="font-display text-xl text-ink">
              {STATUS_LABELS[status]}
            </p>
            <p className="text-xs text-muted">
              {respondents.length} {respondents.length === 1 ? "person" : "people"}
            </p>
          </div>
          <span className="w-9" />
        </div>

        {/* Roster list */}
        <div className="flex-1 overflow-y-auto px-2 py-2">
          {respondents.length === 0 ? (
            <p className="text-sm text-muted text-center py-8">
              Nobody in this bucket yet.
            </p>
          ) : (
            <ul className="grid gap-1">
              {respondents.map((r) => (
                <li
                  key={r.id}
                  className="px-4 py-3 rounded-2xl hover:bg-card/60 grid gap-2 sm:flex sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-ink truncate">
                      {r.name}
                      {r.is_planner && (
                        <span className="ml-2 text-[10px] uppercase tracking-widest font-bold text-gold">host</span>
                      )}
                    </p>
                    {r.phone && (
                      <p className="text-xs text-muted truncate">{r.phone}</p>
                    )}
                  </div>
                  {canManage && (
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <label className="sr-only" htmlFor={`override-${r.id}`}>Override RSVP for {r.name}</label>
                      <select
                        id={`override-${r.id}`}
                        value={(r.rsvp_status ?? "invited") as RsvpStatus}
                        disabled={pendingOverride === r.id}
                        onChange={(e) => handleOverride(r.id, e.target.value as RsvpStatus)}
                        className="h-9 rounded-full border border-line bg-card text-sm text-ink pl-3 pr-7 focus:border-green focus:outline-none disabled:opacity-50"
                      >
                        <option value="going">Going</option>
                        <option value="maybe">Maybe</option>
                        <option value="invited">Invited</option>
                        <option value="cant_go">Can&apos;t go</option>
                      </select>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Footer — group-nudge CTA. Hidden for non-planners and for
            the "going" bucket (no need to nudge people who already
            said yes). */}
        {canManage && respondents.length > 0 && status !== "going" && (
          <div className="px-5 py-4 border-t border-line">
            <button
              onClick={onSendNudge}
              className="w-full h-11 rounded-full bg-green text-cream font-bold hover:bg-green-2 active:scale-95 transition-transform text-sm"
            >
              Send nudge to {STATUS_LABELS[status]} ({respondents.length})
            </button>
            <p className="text-[11px] text-muted mt-2 text-center">
              Opens the blast composer pre-targeted to this group.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
