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
 *   3. router.push() the target page.
 *   4. router.refresh() so server components re-render in the new
 *      authed state.
 *
 * From the user's perspective: a single tap takes them to /trips/new
 * or their profile with no SMS friction.
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

  async function promoteThen(target: "/trips/new" | "__profile__", which: "profile" | "newtrip") {
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
      // Profile click: route directly to /user/<users.id> returned
      // by the promote endpoint (no /trips bounce). Trip-creation
      // click: /trips/new.
      const next =
        target === "__profile__"
          ? body.data.users_id ? `/user/${body.data.users_id}` : "/trips"
          : target;
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
          onClick={() => promoteThen("/trips/new", "newtrip")}
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
