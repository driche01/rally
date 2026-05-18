"use client";

/**
 * RespondentActions — the top-right cluster shown to someone who's
 * RSVPed (rally_session_token cookie present) but never gone
 * through OTP. Mirrors the chip + "+ New trip" shape of the authed
 * branch, but each click runs the promote-from-session flow:
 *
 *   1. POST /api/account/promote-from-session
 *   2. Take the returned token_hash and exchange it via
 *      supabase.auth.verifyOtp({ type: 'magiclink', token_hash })
 *      — sets the Supabase session cookies.
 *   3a. For "new trip": POST /api/trips to create a draft, then
 *       router.push() to /trips/[id]?new=1.
 *   3b. For "profile":  router.push() to /user/[id].
 *   4. router.refresh() so server components re-render in the new
 *      authed state.
 *
 * From the user's perspective: a single tap creates a trip / opens
 * their profile, no SMS friction, no form to fill out.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

interface Props {
  /** Cookie-derived display name (first name). */
  name: string;
  /** Should we render the "+ New trip" pill? Suppressed on the
   *  trip-creation page itself. */
  showNewTrip?: boolean;
}

export default function RespondentActions({ name, showNewTrip = true }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<null | "profile" | "newtrip">(null);
  const [err, setErr] = useState<string | null>(null);

  async function promoteThen(target: "__newtrip__" | "__profile__", which: "profile" | "newtrip") {
    if (busy) return;
    setBusy(which);
    setErr(null);
    try {
      const res = await fetch("/api/account/promote-from-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        setErr(body?.error?.code || "Couldn't sign you in.");
        return;
      }
      const supabase = createClient();
      const { error: vErr } = await supabase.auth.verifyOtp({
        type: "magiclink",
        token_hash: body.data.token_hash,
      });
      if (vErr) {
        setErr(vErr.message);
        return;
      }

      let next: string;
      if (target === "__profile__") {
        // Profile click: route directly to /user/<users.id> returned
        // by the promote endpoint (no /trips bounce).
        next = body.data.users_id ? `/user/${body.data.users_id}` : "/trips";
      } else {
        // New-trip click: create the draft trip with the same fetch
        // identity the promote step just minted, then drop the
        // planner onto its edit surface with the name editor open.
        const tripRes = await fetch("/api/trips", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Untitled trip", status: "draft" }),
        });
        const tripBody = await tripRes.json();
        if (!tripRes.ok || !tripBody.ok || !tripBody.data?.id) {
          setErr(tripBody?.error?.code || "Couldn't create trip");
          return;
        }
        next = `/trips/${tripBody.data.id}?new=1`;
      }

      router.replace(next);
      router.refresh();
    } catch {
      setErr("Couldn't reach Rally. Try again.");
    } finally {
      setBusy(null);
    }
  }

  const initial = name.charAt(0).toUpperCase();

  return (
    <div className="flex items-center gap-2">
      {showNewTrip && (
        <button
          onClick={() => promoteThen("__newtrip__", "newtrip")}
          disabled={busy !== null}
          className="hidden sm:inline-flex h-9 px-3 items-center rounded-full bg-green text-cream text-sm font-bold hover:bg-green-2 active:scale-95 transition-transform disabled:opacity-50"
        >
          {busy === "newtrip" ? "One sec…" : "+ New trip"}
        </button>
      )}
      <button
        onClick={() => promoteThen("__profile__", "profile")}
        disabled={busy !== null}
        aria-label="Go to your account"
        className="flex items-center gap-2 h-9 pl-1 pr-3 rounded-full bg-card border border-line hover:border-green text-sm text-ink active:scale-95 transition-transform disabled:opacity-50"
      >
        <span className="h-7 w-7 rounded-full bg-green-soft text-green font-bold text-xs flex items-center justify-center">
          {initial}
        </span>
        <span className="hidden sm:inline truncate max-w-[8rem]">
          {busy === "profile" ? "One sec…" : name}
        </span>
      </button>
      {err && (
        <span className="text-xs text-orange hidden sm:inline">{err}</span>
      )}
    </div>
  );
}
