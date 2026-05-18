"use client";

/**
 * CreateTripButton — single-tap "new trip" action.
 *
 * Replaces the old /trips/new form (retired 2026-05-16). Tapping this
 * POSTs to /api/trips with minimal defaults, then redirects the
 * planner to /trips/[newId]?new=1. The trip page picks up the ?new=1
 * marker and auto-opens the name editor on first paint so the planner
 * starts typing the trip name immediately — same muscle memory as
 * "form opens, cursor in name field" but without a separate route.
 *
 * Every field the old form collected (destination, dates, theme,
 * description, group size, budget) is editable inline on the trip
 * page itself, so this button skips straight to the surface where
 * those edits land.
 *
 * Usage:
 *   <CreateTripButton className="…">+ New trip</CreateTripButton>
 *   <CreateTripButton variant="primary" />     defaults to "+ New trip"
 *
 * The component is "use client" — pages that need it from a server
 * component (app-header.tsx) import and render it directly. No prop
 * drilling required.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  /** Display label, e.g. "+ New trip" or "+ Start a trip". */
  children?: React.ReactNode;
  /** Tailwind classes on the button. */
  className?: string;
}

export default function CreateTripButton({
  children = "+ New trip",
  className = "",
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState<string | null>(null);

  async function create() {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/trips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // "Untitled trip" is the placeholder the planner replaces on
        // first paint via the auto-opened name editor. Empty / null
        // name would 400 at the API (name_required), so we send a
        // visible-but-disposable string.
        //
        // status: "draft" makes the trip unsaved-by-default — the
        // SaveTripBanner shows at the top of the page until the
        // planner explicitly clicks Save. Inline field edits still
        // auto-save, but the trip's identity is provisional until
        // they confirm.
        body: JSON.stringify({ name: "Untitled trip", status: "draft" }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        setErr(body?.error?.code || "Couldn't create trip");
        return;
      }
      const tripId = body.data?.id;
      if (!tripId) {
        setErr("Couldn't create trip");
        return;
      }
      // ?new=1 tells EditableTripHeader to auto-open the name editor
      // so the planner doesn't have to click the title to rename it.
      router.push(`/trips/${tripId}?new=1`);
      router.refresh();
    } catch {
      setErr("Couldn't reach Rally. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={create}
      disabled={busy}
      className={className}
      aria-label="Create a new trip"
    >
      {busy ? "One sec…" : children}
      {err && (
        <span className="ml-2 text-xs text-orange">{err}</span>
      )}
    </button>
  );
}
