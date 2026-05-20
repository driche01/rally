"use client";

/**
 * DraftGuard — intercepts navigation away from a draft trip with no
 * invitations and prompts the planner to save (promote to active) or
 * discard (hard-delete the trip).
 *
 * Activation rules (all must be true):
 *   - canEdit (planner only — cohosts can't discard)
 *   - status === "draft"
 *   - !hasInvitations (no non-planner respondents yet)
 *
 * Interception:
 *   1. Anchor clicks anywhere on the page (capture phase) — skipped
 *      when the link stays within /trips/[id]/* (tab switches don't
 *      count as "leaving the draft").
 *   2. popstate — browser back button. Same treatment as anchor
 *      clicks: show custom modal, push the URL back to the trip if
 *      the planner cancels.
 *
 * Not intercepted: tab close / refresh / manual URL change. Field
 * edits already auto-save, so closing the tab just leaves the trip
 * as a draft the planner can return to later. Adding a beforeunload
 * prompt would just be a noisy native dialog on top of the data we
 * already persisted.
 *
 * Actions:
 *   - Save     → PATCH /api/trips/[id] { status: "active" } then
 *                follow through with the original navigation.
 *   - Discard  → DELETE /api/trips/[id] then follow through.
 *   - Stay     → cancel the modal, restore the URL if popstate.
 *
 * Once status flips to "active" or the trip gets its first
 * invitation, the parent layout passes new props in and the guard
 * unmounts itself effectively.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

interface Props {
  tripId: string;
  status: string;
  hasInvitations: boolean;
  canEdit: boolean;
}

type PendingNav =
  | { kind: "url";      href: string  }
  | { kind: "popstate"; prevUrl: string };

export default function DraftGuard({
  tripId, status, hasInvitations, canEdit,
}: Props) {
  const router = useRouter();
  const [pending, setPending] = useState<PendingNav | null>(null);
  const [busy,    setBusy]    = useState<null | "save" | "discard">(null);
  const [err,     setErr]     = useState<string | null>(null);
  const armed = canEdit && status === "draft" && !hasInvitations;

  // Track the most recent committed URL so popstate can restore.
  const lastUrl = useRef<string | null>(null);
  useEffect(() => {
    if (typeof window !== "undefined") lastUrl.current = window.location.href;
  });

  useEffect(() => {
    if (!armed) return;

    function isLeavingTrip(href: string): boolean {
      try {
        const target = new URL(href, window.location.origin);
        // Cross-origin → leaving
        if (target.origin !== window.location.origin) return true;
        // Stays inside /trips/[id]/* → not leaving (tab switches etc.)
        const tripBase = `/trips/${tripId}`;
        return !(target.pathname === tripBase || target.pathname.startsWith(`${tripBase}/`));
      } catch {
        return false;
      }
    }

    // 1. Capture-phase anchor click interception.
    function onClick(e: MouseEvent) {
      // Don't interfere with modifier-clicks (open in new tab, etc.)
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      const a = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a) return;
      if (a.target === "_blank") return;            // new tab is fine
      const href = a.getAttribute("href");
      if (!href || href === "#" || href.startsWith("javascript:")) return;
      if (!isLeavingTrip(href)) return;
      e.preventDefault();
      e.stopPropagation();
      setPending({ kind: "url", href });
    }

    // 2. popstate — browser back. Push the prior URL back, show modal.
    function onPopState() {
      const before = lastUrl.current ?? `/trips/${tripId}`;
      // The back button has already happened. Restore the URL while
      // we ask, and stash where they were trying to go.
      const target = window.location.href;
      window.history.pushState(null, "", before);
      setPending({ kind: "popstate", prevUrl: target });
    }

    document.addEventListener("click", onClick, true);
    window.addEventListener("popstate", onPopState);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("popstate", onPopState);
    };
  }, [armed, tripId]);

  if (!armed || !pending) return null;

  async function followThrough() {
    if (!pending) return;
    if (pending.kind === "url") {
      router.push(pending.href);
    } else {
      // popstate: actually navigate to where they tried to go
      window.location.href = pending.prevUrl;
    }
  }

  async function onSave() {
    if (busy) return;
    setBusy("save");
    setErr(null);
    try {
      const res = await fetch(`/api/trips/${tripId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "active" }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        setErr(body?.error?.code || "Save failed");
        return;
      }
      await followThrough();
    } catch {
      setErr("Couldn't reach Rally. Try again.");
    } finally {
      setBusy(null);
    }
  }

  async function onDiscard() {
    if (busy) return;
    if (!confirm("Discard this draft? This deletes the trip permanently.")) return;
    setBusy("discard");
    setErr(null);
    try {
      const res = await fetch(`/api/trips/${tripId}`, { method: "DELETE" });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        setErr(body?.error?.code || "Discard failed");
        return;
      }
      await followThrough();
    } catch {
      setErr("Couldn't reach Rally. Try again.");
    } finally {
      setBusy(null);
    }
  }

  function onStay() {
    setPending(null);
    setErr(null);
  }

  return (
    <ModalShell onClose={onStay}>
      <div className="px-6 py-5 border-b border-line">
        <p className="text-xs font-bold tracking-widest uppercase text-gold mb-1">
          Draft trip
        </p>
        <h2 className="font-display text-2xl text-ink">
          Save this trip before you leave?
        </h2>
      </div>
      <div className="px-6 py-5 grid gap-4">
        <p className="text-sm text-muted">
          You haven&apos;t invited anyone yet. Save it to keep editing later, or
          discard to throw it away.
        </p>
        {err && <p className="text-sm text-orange">{err}</p>}
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
          <button
            onClick={onDiscard}
            disabled={busy !== null}
            className="h-11 px-5 rounded-full bg-card text-destructive border border-line hover:border-destructive disabled:opacity-50"
          >
            {busy === "discard" ? "Discarding…" : "Discard"}
          </button>
          <button
            onClick={onStay}
            disabled={busy !== null}
            className="h-11 px-5 rounded-full bg-card text-muted border border-line hover:border-green hover:text-ink disabled:opacity-50"
          >
            Keep editing
          </button>
          <button
            onClick={onSave}
            disabled={busy !== null}
            className="h-11 px-6 rounded-full bg-green text-cream font-bold hover:bg-green-2 disabled:opacity-50"
          >
            {busy === "save" ? "Saving…" : "Save & leave"}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function ModalShell({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  // Lock body scroll while modal is up. Backdrop click + Esc close.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[60] bg-ink/75 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="bg-cream w-full sm:max-w-md sm:rounded-[28px] rounded-t-[28px] max-h-[92dvh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
