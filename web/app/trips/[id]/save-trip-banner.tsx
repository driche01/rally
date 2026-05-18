"use client";

/**
 * SaveTripBanner — sticky strip at the top of the trip page shown
 * whenever a draft trip is being viewed by a planner/cohost. The
 * trip exists in the DB and inline edits auto-save as the planner
 * fills it in, but the trip itself is considered "unsaved" until
 * the planner explicitly confirms by clicking Save.
 *
 * Save flow: PATCH /api/trips/[id] with { status: "active" } →
 * router.refresh() pulls the new server-rendered tree, which
 * causes this banner to unmount on the next render (the parent
 * passes status, and the trip is no longer "draft").
 *
 * Hidden when:
 *   - canEdit is false (respondents never see this)
 *   - status is already "active" (trip is saved)
 *   - trip is cancelled (cancelled drafts shouldn't be re-saveable)
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function SaveTripBanner({
  tripId,
  status,
  cancelled,
  canEdit,
}: {
  tripId: string;
  status: string;
  cancelled: boolean;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState<string | null>(null);

  if (!canEdit || cancelled || status !== "draft") return null;

  async function save() {
    if (busy) return;
    setBusy(true);
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
      // Authoritative re-render — the parent layout re-fetches the
      // trip + passes the new status down, which unmounts this banner.
      router.refresh();
    } catch {
      setErr("Couldn't reach Rally. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="mb-3 flex items-center justify-between gap-3"
      role="status"
      aria-live="polite"
    >
      <p className="text-xs text-muted min-w-0 flex-1 truncate">
        <span className="font-semibold text-ink/70">Draft</span>
        <span className="mx-1.5 opacity-50">·</span>
        Save when you&apos;re ready.
        {err && <span className="ml-2 text-orange">{err}</span>}
      </p>
      <button
        type="button"
        onClick={save}
        disabled={busy}
        className="h-8 px-3 rounded-full bg-card border border-line text-ink hover:border-green text-xs font-semibold disabled:opacity-50 whitespace-nowrap flex-shrink-0"
      >
        {busy ? "Saving…" : "Save"}
      </button>
    </div>
  );
}
