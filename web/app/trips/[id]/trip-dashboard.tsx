"use client";

/**
 * Overview tab content — stats, roster, activity preview.
 *
 * The trip hero + header + tab nav live in /trips/[id]/layout.tsx.
 * Host actions (Invite, Copy share, Send blast, Clone, Cancel) also
 * live in the layout under the cover image — see trip-actions.tsx.
 *
 * This component owns: the stall-signal nudge banner (which renders
 * its own pre-filled blast composer separate from the layout's
 * blank-state composer), the editable description, stats, roster,
 * and the activity-feed preview.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Trip, Respondent, ActivityFeedEntry, RsvpStatus } from "@shared/types";
import type { StallSignal } from "@/lib/stall-detector";
import { themeClass } from "@/lib/themes";
import { EditableTextarea } from "@/lib/editable";
import Roster from "./roster";
import BlastComposer from "./blast-composer";
import StatModal from "./stat-modal";

export default function TripDashboard({
  trip, respondents: initialRespondents, activity, inviteUrl, stallSignal, canEdit,
}: {
  trip: Trip;
  respondents: Respondent[];
  activity: ActivityFeedEntry[];
  inviteUrl: string;
  stallSignal: StallSignal | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [respondents, setRespondents] = useState<Respondent[]>(initialRespondents);
  const [activityFeed] = useState<ActivityFeedEntry[]>(activity);
  const [showBlast, setShowBlast]   = useState(false);
  const [blastPrefill, setBlastPrefill] = useState<{
    body: string;
    segment: "going" | "maybe" | "invited" | "all" | "unresponded";
    source: string;
  } | null>(null);
  // Which stat card's modal is open (null = none). The modal owns
  // the per-respondent override + a group-nudge CTA that closes
  // it and re-opens the BlastComposer pre-targeted at this status.
  const [statModal, setStatModal] = useState<RsvpStatus | null>(null);
  const cancelled = Boolean(trip.cancelled_at);

  function openBlastFromBanner() {
    if (!stallSignal) {
      setShowBlast(true);
      return;
    }
    // Bake the share link + trip name into the body. [Name] stays
    // as a token so the blast pipeline substitutes per recipient.
    const body = `${stallSignal.cta} ${inviteUrl}`;
    setBlastPrefill({
      body,
      segment: stallSignal.defaultSegment,
      source: stallSignal.headline.toLowerCase().replace(/\.$/, ""),
    });
    setShowBlast(true);
  }

  function closeBlast() {
    setShowBlast(false);
    setBlastPrefill(null);
  }

  async function handleOverride(respondent_id: string, rsvp_status: RsvpStatus) {
    // Optimistic: flip the chip immediately so the menu close +
    // status update feel instant. Snapshot the old value so we can
    // roll back if the server rejects.
    const prevRespondents = respondents;
    setRespondents((prev) =>
      prev.map((r) => (r.id === respondent_id
        ? { ...r, rsvp_status, rsvp_status_updated_at: new Date().toISOString() }
        : r)),
    );
    try {
      const res = await fetch(`/api/trips/${trip.id}/memberships`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ respondent_id, rsvp_status }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        setRespondents(prevRespondents);
        alert(`Override failed: ${body?.error?.code ?? res.status}`);
        return;
      }
      // Reconcile with authoritative server data.
      setRespondents((prev) =>
        prev.map((r) => (r.id === respondent_id ? (body.data as Respondent) : r)),
      );
    } catch {
      setRespondents(prevRespondents);
      alert("Couldn't reach Rally. Try again.");
    }
  }

  const counts = countByStatus(respondents);
  const t = themeClass(trip.theme);

  return (
    <div>
      {cancelled && (
        <div className="mb-6 bg-orange/10 border border-orange/40 text-ink rounded-2xl p-4">
          <p className="text-xs font-bold tracking-widest uppercase text-orange mb-1">
            Cancelled
          </p>
          <p className="text-sm">
            This trip was cancelled by the host. The activity feed stays visible, but no new RSVPs or actions are accepted.
          </p>
        </div>
      )}

      {!cancelled && stallSignal && (
        <div className="mb-6 bg-gold/10 border border-gold/40 text-ink rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <p className="text-xs font-bold tracking-widest uppercase text-gold mb-1">
              Heads up
            </p>
            <p className="text-sm font-semibold">{stallSignal.headline}</p>
            <p className="text-sm text-muted">{stallSignal.detail}</p>
          </div>
          <button
            onClick={openBlastFromBanner}
            className="h-10 px-4 rounded-full bg-gold text-ink font-bold hover:bg-gold/80 text-sm whitespace-nowrap"
          >
            Send a nudge →
          </button>
        </div>
      )}

      {/* Trip description (under header from layout) — editable
          inline for planners + cohosts, plain text for everyone else. */}
      {(trip.description || canEdit) && (
        <div className={`mb-8 max-w-prose ${t.body}`}>
          <EditableTextarea
            value={trip.description}
            canEdit={canEdit}
            placeholder="Add a description — what's this trip about?"
            rows={4}
            maxLength={2000}
            renderDisplay={(v) =>
              v ? <p className="whitespace-pre-line">{v}</p> : null
            }
            onSave={async (v) => {
              const res = await fetch(`/api/trips/${trip.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ description: v }),
              });
              const body = await res.json();
              if (!res.ok || !body.ok) {
                throw new Error(body?.error?.code || "Update failed");
              }
              router.refresh();
            }}
          />
        </div>
      )}

      {/* ─── Quick stats ───────────────────────────── */}
      {/* Each card opens a status modal — see <Stat> below. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
        <Stat label="Going"    value={counts.going}   t={t} onClick={() => setStatModal("going")} />
        <Stat label="Maybe"    value={counts.maybe}   t={t} onClick={() => setStatModal("maybe")} />
        <Stat label="Invited"  value={counts.invited} t={t} onClick={() => setStatModal("invited")} />
        <Stat label="Can't go" value={counts.cant_go} t={t} onClick={() => setStatModal("cant_go")} />
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

      {showBlast && (
        <BlastComposer
          tripId={trip.id}
          tripName={trip.name}
          respondents={respondents}
          onClose={closeBlast}
          initialBody={blastPrefill?.body}
          initialSegment={blastPrefill?.segment}
          prefillSource={blastPrefill?.source}
        />
      )}

      {statModal && (
        <StatModal
          status={statModal}
          respondents={respondents.filter(
            (r) => ((r.rsvp_status ?? "invited") as RsvpStatus) === statModal,
          )}
          onClose={() => setStatModal(null)}
          onOverride={handleOverride}
          canManage={canEdit && !cancelled}
          onSendNudge={() => {
            // Close the stat modal and open the blast composer
            // pre-targeted at this status. The segment names line
            // up directly with RsvpStatus (going / maybe / invited),
            // but cant_go isn't a valid blast segment — fall back
            // to "invited" if the planner somehow opened a Can't-go
            // nudge (the CTA is hidden in that case anyway).
            const segment =
              statModal === "going"   ? "going"
            : statModal === "maybe"   ? "maybe"
            : statModal === "invited" ? "invited"
            : "all";
            setBlastPrefill({
              body: "",
              segment,
              source: `${statModal} status nudge`,
            });
            setStatModal(null);
            setShowBlast(true);
          }}
        />
      )}
    </div>
  );
}

function Stat({
  label, value, t, onClick,
}: {
  label: string;
  value: number;
  t: ReturnType<typeof themeClass>;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${t.surface} border ${t.surfaceBorder} rounded-2xl p-4 text-left hover:border-green active:scale-[0.98] transition-transform`}
    >
      <p className={`text-xs uppercase tracking-widest font-semibold ${t.meta}`}>
        {label}
      </p>
      <p className={`text-3xl mt-1 ${t.display}`}>{value}</p>
    </button>
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
