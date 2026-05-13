"use client";

/**
 * Overview tab content — stats, actions, roster, activity preview.
 *
 * The trip hero + header + tab nav live in /trips/[id]/layout.tsx
 * (post-Phase-B Step 4 refactor). This component is just the
 * Overview tab's body.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Trip, Respondent, ActivityFeedEntry, RsvpStatus } from "@shared/types";
import { themeClass } from "@/lib/themes";
import Roster from "./roster";
import InviteModal from "./invite-modal";
import BlastComposer from "./blast-composer";

export default function TripDashboard({
  trip, respondents: initialRespondents, activity, inviteUrl,
}: {
  trip: Trip;
  respondents: Respondent[];
  activity: ActivityFeedEntry[];
  inviteUrl: string;
}) {
  const router = useRouter();
  const [, startTrans] = useTransition();
  const [respondents, setRespondents] = useState<Respondent[]>(initialRespondents);
  const [activityFeed, setActivityFeed] = useState<ActivityFeedEntry[]>(activity);
  const [showInvite, setShowInvite] = useState(false);
  const [showBlast, setShowBlast]   = useState(false);
  const [copied, setCopied] = useState(false);
  const [cloning, setCloning] = useState(false);

  async function clone() {
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

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy this link:", inviteUrl);
    }
  }

  async function handleOverride(respondent_id: string, rsvp_status: RsvpStatus) {
    const res = await fetch(`/api/trips/${trip.id}/memberships`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ respondent_id, rsvp_status }),
    });
    const body = await res.json();
    if (!res.ok || !body.ok) {
      alert(`Override failed: ${body?.error?.code ?? res.status}`);
      return;
    }
    setRespondents((prev) =>
      prev.map((r) => (r.id === respondent_id ? (body.data as Respondent) : r)),
    );
  }

  function handleInvitationsSent(newRespondents: Respondent[], summary: ActivityFeedEntry | null) {
    setRespondents((prev) => {
      const map = new Map(prev.map((r) => [r.id, r]));
      for (const r of newRespondents) map.set(r.id, r);
      return Array.from(map.values());
    });
    if (summary) setActivityFeed((prev) => [summary, ...prev]);
    setShowInvite(false);
  }

  const counts = countByStatus(respondents);
  const t = themeClass(trip.theme);

  return (
    <div>
      {/* Trip description (under header from layout) */}
      {trip.description && (
        <p className={`mb-8 max-w-prose whitespace-pre-line ${t.body}`}>
          {trip.description}
        </p>
      )}

      {/* ─── Quick stats ───────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
        <Stat label="Going"    value={counts.going}   t={t} />
        <Stat label="Maybe"    value={counts.maybe}   t={t} />
        <Stat label="Invited"  value={counts.invited} t={t} />
        <Stat label="Can't go" value={counts.cant_go} t={t} />
      </div>

      {/* ─── Actions ───────────────────────────────── */}
      <div className="flex flex-wrap gap-3 mb-8">
        <button
          onClick={() => setShowInvite(true)}
          className="h-12 px-6 rounded-full bg-green text-cream font-bold hover:bg-green-2"
        >
          Invite people →
        </button>
        <button
          onClick={copyLink}
          className={`h-12 px-5 rounded-full ${t.surface} text-ink border ${t.surfaceBorder} hover:border-green`}
        >
          {copied ? "Copied ✓" : "Copy share link"}
        </button>
        <button
          onClick={() => setShowBlast(true)}
          className={`h-12 px-5 rounded-full ${t.surface} text-ink border ${t.surfaceBorder} hover:border-green`}
        >
          Send blast →
        </button>
        <button
          onClick={clone}
          disabled={cloning}
          className={`h-12 px-5 rounded-full ${t.surface} text-ink border ${t.surfaceBorder} hover:border-green disabled:opacity-50`}
          title="Duplicate trip metadata + cohosts. No invitees / itinerary / lodging / etc. carry over."
        >
          {cloning ? "Cloning…" : "Clone trip"}
        </button>
      </div>

      {/* ─── Roster ────────────────────────────────── */}
      <Roster respondents={respondents} onOverride={handleOverride} />

      {/* ─── Activity feed preview ─────────────────── */}
      {activityFeed.length > 0 && (
        <section className="mt-12">
          <h2 className={`text-2xl mb-4 ${t.display}`}>Activity</h2>
          <ul className="grid gap-3">
            {activityFeed.slice(0, 10).map((e) => (
              <li
                key={e.id}
                className={`${t.surface} border ${t.surfaceBorder} rounded-2xl p-4 text-sm`}
              >
                <p className={`text-xs uppercase tracking-widest font-semibold mb-1 ${t.meta}`}>
                  {formatEntryType(e.entry_type)} · {formatRelative(e.created_at)}
                </p>
                <p className={t.body}>{formatEntryContent(e)}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {showInvite && (
        <InviteModal
          tripId={trip.id}
          tripName={trip.name}
          shareLink={inviteUrl}
          onClose={() => setShowInvite(false)}
          onSent={handleInvitationsSent}
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
    </div>
  );
}

function Stat({ label, value, t }: { label: string; value: number; t: ReturnType<typeof themeClass> }) {
  return (
    <div className={`${t.surface} border ${t.surfaceBorder} rounded-2xl p-4`}>
      <p className={`text-xs uppercase tracking-widest font-semibold ${t.meta}`}>
        {label}
      </p>
      <p className={`text-3xl mt-1 ${t.display}`}>{value}</p>
    </div>
  );
}

function countByStatus(rs: Respondent[]): Record<RsvpStatus, number> {
  const c: Record<RsvpStatus, number> = {
    going: 0, maybe: 0, invited: 0, cant_go: 0,
  };
  for (const r of rs) {
    const k = (r.rsvp_status ?? "invited") as RsvpStatus;
    if (k in c) c[k]++;
  }
  return c;
}

function formatRelative(iso: string): string {
  const ago = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ago / 1000);
  if (s < 60)    return "just now";
  if (s < 3600)  return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function formatEntryType(t: ActivityFeedEntry["entry_type"]): string {
  switch (t) {
    case "rsvp_update":  return "RSVP";
    case "comment":      return "Comment";
    case "gif":          return "Gif";
    case "photo":        return "Photo";
    case "planner_post": return "From the host";
    case "system":       return "Update";
  }
}

function formatEntryContent(e: ActivityFeedEntry): string {
  const c = e.content as Record<string, unknown>;
  if (typeof c.text === "string") return c.text;
  if (typeof c.message === "string") return c.message;
  if (typeof c.name === "string" && typeof c.status === "string") {
    return `${c.name} → ${c.status}`;
  }
  return "(see details)";
}
