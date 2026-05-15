"use client";

/**
 * RsvpFlow — orchestrator for /invite/[token]/rsvp.
 *
 * Stages:
 *   1. identify — phone + name input
 *   2. lookup — call /api/invite/[token]/check, decide branch
 *   3a. capture — first-time user, render ProfileCapture
 *   3b. confirm — returning user, one-tap confirm
 *   4. submit — POST to /api/invite/[token]/rsvp
 *   5. done — success state, link back to invitation page
 */

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ProfileCapture from "./profile-capture";
import { IconSprite, Icon } from "./icons";
import RallyLogo from "@/lib/brand/logo";
import type {
  RsvpStatus, ProfileCaptureInput, TravelerProfile,
} from "@shared/types";

type Stage = "identify" | "lookup" | "capture" | "confirm" | "submit" | "done" | "error";

const CHOICE_LABELS: Record<RsvpStatus, string> = {
  going:   "Going",
  maybe:   "Maybe",
  cant_go: "Can't go",
  invited: "Invited",
};

const CHOICE_EYEBROWS: Record<RsvpStatus, string> = {
  going:   "Locking it in",
  maybe:   "Almost in",
  cant_go: "Catching the next one",
  invited: "—",
};

export default function RsvpFlow({
  shareToken,
  choice,
  tripName,
}: {
  shareToken: string;
  choice: RsvpStatus;
  tripName: string;
}) {
  const router = useRouter();

  const [stage, setStage] = useState<Stage>("identify");
  const [phone, setPhone] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName]   = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  // Derived once for API payloads + greeting copy.
  const name = `${firstName.trim()} ${lastName.trim()}`.trim();

  // From the lookup step
  const [existingProfile, setExistingProfile] = useState<Partial<TravelerProfile> | null>(null);
  const [needsCapture, setNeedsCapture] = useState<boolean>(true);

  // Captured during this session (if running ProfileCapture)
  const [capture, setCapture] = useState<ProfileCaptureInput | null>(null);

  async function startLookup(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!phone.trim() || !firstName.trim()) {
      setErr("Phone and first name are required.");
      return;
    }
    setStage("lookup");
    try {
      const url = `/api/invite/${shareToken}/check?phone=${encodeURIComponent(phone)}`;
      const r = await fetch(url);
      const body = await r.json();
      if (!r.ok || !body.ok) {
        setErr(body?.error?.code || `Lookup failed (${r.status})`);
        setStage("error");
        return;
      }
      setExistingProfile(body.data.profile);
      setNeedsCapture(body.data.needs_capture);
      setStage(body.data.needs_capture ? "capture" : "confirm");
    } catch {
      setErr("Couldn't reach Rally. Try again.");
      setStage("error");
    }
  }

  async function submit(profileOverride?: ProfileCaptureInput) {
    setStage("submit");
    setErr(null);
    const profileToSend = profileOverride ?? capture;
    try {
      const r = await fetch(`/api/invite/${shareToken}/rsvp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone,
          first_name: firstName.trim(),
          last_name:  lastName.trim() || undefined,
          // Send legacy `name` too so the API doesn't have to recompose
          // it; helps if anything mid-pipeline reads the raw payload.
          name,
          rsvp_status: choice,
          note: note || undefined,
          profile: profileToSend ?? undefined,
        }),
      });
      const body = await r.json();
      if (!r.ok || !body.ok) {
        setErr(body?.error?.code || `Submit failed (${r.status})`);
        setStage("error");
        return;
      }
      setStage("done");
    } catch {
      setErr("Couldn't reach Rally. Try again.");
      setStage("error");
    }
  }

  function onCaptureComplete(data: ProfileCaptureInput) {
    setCapture(data);
    // Submit immediately — capture is the final UX gate, no separate
    // confirm screen for first-timers.
    submit(data);
  }

  // ─── Render ────────────────────────────────────────────────────
  return (
    <main className="min-h-dvh">
      <IconSprite />
      <div className="max-w-2xl mx-auto px-5 sm:px-8 py-6">
        <header className="mb-6 flex items-center justify-between">
          <RallyLogo size="md" />
          <Link
            href={`/invite/${shareToken}`}
            className="text-xs text-muted tracking-widest uppercase font-semibold hover:text-ink"
          >
            ← {tripName}
          </Link>
        </header>

        {stage === "identify" && (
          <form onSubmit={startLookup} className="mt-6 grid gap-5">
            <p className="text-xs font-bold tracking-widest uppercase text-green">
              {CHOICE_EYEBROWS[choice]}
            </p>
            <h1 className="font-display text-3xl sm:text-4xl leading-tight text-ink">
              {choice === "cant_go"
                ? "Sorry to miss this one."
                : choice === "maybe"
                ? "Got it — Maybe."
                : "Let's lock it in."}
            </h1>
            <p className="text-muted">
              Quick check — your name and phone. We&apos;ll use this to track
              your RSVP and set up your Rally account so you only fill it
              out once.
            </p>

            <div className="grid grid-cols-2 gap-3">
              <label className="grid gap-2">
                <span className="text-xs uppercase tracking-widest text-muted font-semibold">First name</span>
                <input
                  type="text"
                  required
                  maxLength={30}
                  autoComplete="given-name"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="Sam"
                  className="h-14 rounded-xl border border-line bg-card px-4 text-lg text-ink placeholder:text-muted focus:border-green focus:outline-none"
                />
              </label>
              <label className="grid gap-2">
                <span className="text-xs uppercase tracking-widest text-muted font-semibold">Last name</span>
                <input
                  type="text"
                  maxLength={30}
                  autoComplete="family-name"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Rivera"
                  className="h-14 rounded-xl border border-line bg-card px-4 text-lg text-ink placeholder:text-muted focus:border-green focus:outline-none"
                />
              </label>
            </div>
            <label className="grid gap-2">
              <span className="text-xs uppercase tracking-widest text-muted font-semibold">Phone</span>
              <input
                type="tel"
                inputMode="tel"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="(555) 123-4567"
                className="h-14 rounded-xl border border-line bg-card px-4 text-lg text-ink placeholder:text-muted focus:border-green focus:outline-none"
              />
            </label>
            {choice === "cant_go" && (
              <label className="grid gap-2">
                <span className="text-xs uppercase tracking-widest text-muted font-semibold">
                  Optional note
                </span>
                <textarea
                  rows={2}
                  maxLength={280}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="If you want to say why — they'll see it."
                  className="rounded-xl border border-line bg-card px-4 py-3 text-ink placeholder:text-muted focus:border-green focus:outline-none"
                />
              </label>
            )}
            {err && <p className="text-orange text-sm">{err}</p>}
            <button
              type="submit"
              className="h-14 rounded-full bg-green text-cream font-bold hover:bg-green-2"
            >
              Continue →
            </button>
          </form>
        )}

        {stage === "lookup" && (
          <CenteredStatus h="One second…" sub="Looking you up." />
        )}

        {stage === "capture" && (
          <div className="mt-6">
            <p className="text-xs font-bold tracking-widest uppercase text-green mb-3">
              {existingProfile?.vibe_captured_at ? "Tune your profile" : "The vibe check"}
            </p>
            <h1 className="font-display text-3xl sm:text-4xl leading-tight text-ink mb-1">
              {existingProfile?.vibe_captured_at
                ? "Your answers — tweak any."
                : "Twenty-five seconds, six taps."}
            </h1>
            <p className="text-muted mb-6">
              {existingProfile?.vibe_captured_at
                ? "Pre-filled from your last RSVP. Updates carry across every Rally trip."
                : "Fills in once, helps the host plan around how you actually travel."}
            </p>
            <ProfileCapture
              onComplete={onCaptureComplete}
              initial={existingProfile ? {
                vibe_beach_or_mountain:     existingProfile.vibe_beach_or_mountain     ?? null,
                vibe_spa_or_hike:           existingProfile.vibe_spa_or_hike           ?? null,
                vibe_foodie_or_casual:      existingProfile.vibe_foodie_or_casual      ?? null,
                vibe_social_or_chill:       existingProfile.vibe_social_or_chill       ?? null,
                vibe_culture_or_relaxation: existingProfile.vibe_culture_or_relaxation ?? null,
                home_airport:               existingProfile.home_airport               ?? null,
                dietary_restrictions:       existingProfile.dietary_restrictions       ?? null,
                budget_comfort:             existingProfile.budget_comfort             ?? null,
              } : undefined}
            />
          </div>
        )}

        {stage === "confirm" && existingProfile && (
          <ConfirmStage
            profile={existingProfile}
            onConfirm={() => submit(undefined)}
            onEdit={() => setStage("capture")}
          />
        )}

        {stage === "submit" && (
          <CenteredStatus h="Locking it in…" sub="One second." />
        )}

        {stage === "done" && (
          <DoneStage choice={choice} shareToken={shareToken} />
        )}

        {stage === "error" && (
          <div className="mt-10 grid gap-4">
            <h1 className="font-display text-3xl text-ink">Hit a snag.</h1>
            <p className="text-muted">{err || "Something didn't work."}</p>
            <button
              onClick={() => { setErr(null); setStage("identify"); }}
              className="h-12 px-6 rounded-full bg-green text-cream font-bold w-fit"
            >
              Try again
            </button>
          </div>
        )}
      </div>
    </main>
  );
}

function ConfirmStage({
  profile, onConfirm, onEdit,
}: {
  profile: Partial<TravelerProfile>;
  onConfirm: () => void;
  onEdit: () => void;
}) {
  const summary = useProfileSummary(profile);
  return (
    <div className="mt-6 grid gap-5">
      <p className="text-xs font-bold tracking-widest uppercase text-green">
        Already on file
      </p>
      <h1 className="font-display text-3xl sm:text-4xl leading-tight text-ink">
        Looks right?
      </h1>
      <p className="text-muted">
        Your profile from a past trip. One tap and you&apos;re in.
      </p>
      <div className="bg-card border border-line rounded-[18px] p-4 grid gap-2">
        {summary.map(({ label, value }) => (
          <div key={label} className="flex items-baseline justify-between gap-3 text-sm">
            <dt className="text-xs uppercase tracking-widest text-muted font-semibold">
              {label}
            </dt>
            <dd className="text-ink font-semibold text-right">
              {value ?? <span className="text-muted font-normal">—</span>}
            </dd>
          </div>
        ))}
      </div>
      <button
        onClick={onConfirm}
        className="h-14 rounded-full bg-green text-cream font-bold hover:bg-green-2"
      >
        Yes, RSVP me →
      </button>
      <button
        onClick={onEdit}
        className="h-12 rounded-full bg-card text-muted border border-line hover:border-green hover:text-ink"
      >
        Edit profile first
      </button>
    </div>
  );
}

function useProfileSummary(p: Partial<TravelerProfile>) {
  const pretty = (v: string | null | undefined) =>
    v ? v.charAt(0).toUpperCase() + v.slice(1) : null;
  const diet = (p.dietary_restrictions ?? []).map((d) => d.replace(/_/g, " "));
  return [
    { label: "Vibe",         value: pretty(p.vibe_beach_or_mountain) },
    { label: "Off-day",      value: pretty(p.vibe_spa_or_hike) },
    { label: "Dinner",       value: pretty(p.vibe_foodie_or_casual) },
    { label: "Nights",       value: pretty(p.vibe_social_or_chill) },
    { label: "Energy",       value: pretty(p.vibe_culture_or_relaxation) },
    { label: "Home airport", value: p.home_airport ?? null },
    { label: "Dietary",      value: diet.length ? diet.join(", ") : null },
    { label: "Budget",       value: pretty(p.budget_comfort) },
  ];
}

function DoneStage({ choice, shareToken }: { choice: RsvpStatus; shareToken: string }) {
  return (
    <div className="mt-10 text-center">
      <div className="inline-flex w-16 h-16 rounded-full bg-green-soft items-center justify-center mb-6 text-green">
        <Icon id="i-check" className="w-8 h-8" />
      </div>
      <h1 className="font-display text-3xl sm:text-4xl text-ink mb-3">
        {choice === "cant_go"
          ? "Got it."
          : choice === "maybe"
          ? "Pencilled in."
          : "You’re in."}
      </h1>
      <p className="text-muted max-w-md mx-auto mb-8">
        {choice === "cant_go"
          ? "Logged. The host will see your note if you left one."
          : "The host can see your RSVP. Watch for a heads-up text when there's something to vote on."}
      </p>
      <Link
        href={`/invite/${shareToken}`}
        className="inline-flex h-12 px-6 rounded-full bg-green text-cream font-bold hover:bg-green-2 items-center"
      >
        Back to the trip
      </Link>
    </div>
  );
}

function CenteredStatus({ h, sub }: { h: string; sub: string }) {
  return (
    <div className="min-h-[40vh] flex flex-col items-center justify-center">
      <h2 className="font-display text-2xl text-ink mb-2">{h}</h2>
      <p className="text-muted text-sm">{sub}</p>
    </div>
  );
}
