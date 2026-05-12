"use client";

/**
 * Planner trip dashboard — orchestrates the trip header, roster, and
 * invite modal. Client component because it owns the modal state +
 * optimistic roster updates after a send / override.
 *
 * The hero (cover image + theme treatment) mirrors what the invitee
 * sees on /invite/[token], so the planner can confirm their cover
 * + theme actually applied without leaving the dashboard.
 */

import { useState } from "react";
import type { Trip, Respondent, ActivityFeedEntry, RsvpStatus } from "@shared/types";
import { themeClass } from "@/lib/themes";
import Roster from "./roster";
import InviteModal from "./invite-modal";

export default function TripDashboard({
  trip, respondents: initialRespondents, activity, inviteUrl,
}: {
  trip: Trip;
  respondents: Respondent[];
  activity: ActivityFeedEntry[];
  inviteUrl: string;
}) {
  const [respondents, setRespondents] = useState<Respondent[]>(initialRespondents);
  const [activityFeed, setActivityFeed] = useState<ActivityFeedEntry[]>(activity);
  const [showInvite, setShowInvite] = useState(false);
  const [copied, setCopied] = useState(false);

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
    <main className={`min-h-dvh ${t.root}`}>
      <div className="max-w-3xl mx-auto px-6 py-10">
        {/* ─── Hero: cover + theme treatment (mirrors invitee view) ─ */}
        {trip.cover_image_url ? (
          <div
            className="aspect-[16/10] w-full rounded-[28px] mb-8 bg-cover bg-center bg-cream-2"
            style={{ backgroundImage: `url(${escapeCss(trip.cover_image_url)})` }}
            aria-hidden="true"
          />
        ) : (
          <div className={`aspect-[16/10] w-full rounded-[28px] mb-8 ${t.cover}`}>
            <div className="h-full flex items-center justify-center px-6">
              <span className={`text-3xl sm:text-4xl text-center ${t.coverInk}`}>
                {trip.name}
              </span>
            </div>
          </div>
        )}

        {/* ─── Trip header ───────────────────────────── */}
        <p className={`text-[11px] mb-3 ${t.eyebrow}`}>
          {trip.status === "draft" ? "Draft" : "Live"} ·{" "}
          {trip.theme ?? "no theme yet"}
        </p>
        <h1 className={`text-4xl sm:text-5xl leading-tight mb-3 ${t.display}`}>
          {trip.name}
        </h1>
        {trip.destination && (
          <p className={`text-lg mb-1 ${t.body}`}>{trip.destination}</p>
        )}
        {(trip.start_date || trip.end_date) && (
          <p className={`mb-6 ${t.meta}`}>
            {formatDateRange(trip.start_date, trip.end_date)}
          </p>
        )}
        {trip.description && (
          <p className={`mb-8 max-w-prose whitespace-pre-line ${t.body}`}>
            {trip.description}
          </p>
        )}

        {/* ─── Quick stats ───────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
          <Stat label="Going"    value={counts.going} />
          <Stat label="Maybe"    value={counts.maybe} />
          <Stat label="Invited"  value={counts.invited} />
          <Stat label="Can't go" value={counts.cant_go} />
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
            className="h-12 px-5 rounded-full bg-card text-ink border border-line hover:border-green"
          >
            {copied ? "Copied ✓" : "Copy share link"}
          </button>
        </div>

        {/* ─── Roster ────────────────────────────────── */}
        <Roster
          respondents={respondents}
          onOverride={handleOverride}
        />

        {/* ─── Activity feed (read-only on the dashboard) ─── */}
        {activityFeed.length > 0 && (
          <section className="mt-12">
            <h2 className="font-display text-2xl text-ink mb-4">Activity</h2>
            <ul className="grid gap-3">
              {activityFeed.slice(0, 10).map((e) => (
                <li
                  key={e.id}
                  className="bg-card border border-line rounded-2xl p-4 text-sm"
                >
                  <p className="text-xs uppercase tracking-widest text-muted font-semibold mb-1">
                    {formatEntryType(e.entry_type)} · {formatRelative(e.created_at)}
                  </p>
                  <p className="text-ink">{formatEntryContent(e)}</p>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {showInvite && (
        <InviteModal
          tripId={trip.id}
          tripName={trip.name}
          shareLink={inviteUrl}
          onClose={() => setShowInvite(false)}
          onSent={handleInvitationsSent}
        />
      )}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-card border border-line rounded-2xl p-4">
      <p className="text-xs uppercase tracking-widest text-muted font-semibold">
        {label}
      </p>
      <p className="font-display text-3xl text-ink mt-1">{value}</p>
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

function formatDateRange(start: string | null, end: string | null): string {
  const fmt = (s: string) =>
    new Date(s + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
  if (start && end) {
    const y = new Date(start + "T00:00:00").getFullYear();
    return `${fmt(start)} → ${fmt(end)}, ${y}`;
  }
  if (start) return `From ${fmt(start)}`;
  if (end)   return `Until ${fmt(end)}`;
  return "Dates TBD";
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

function escapeCss(url: string): string {
  return url.replace(/[()'"\\]/g, "\\$&");
}
