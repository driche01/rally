"use client";

/**
 * Lodging tab — AI-suggested options, voting, planner picks one,
 * simple room assignment. Phase B Step 5.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { themeClass } from "@/lib/themes";
import { lodgingSearchSet } from "@/lib/deep-links";
import type { Trip } from "@shared/types";

export interface GoingMember {
  id: string;
  name: string;
}

export interface LodgingOptionView {
  id: string;
  title: string;
  platform: string;
  url: string | null;
  notes: string | null;
  status: string;            // 'option' | 'selected' | 'rejected' | 'booked'
  total_cost_cents: number | null;
  nightly_rate_cents: number | null;
  room_layout: { room: string; beds: string }[] | null;
  ai_suggested: boolean;
  tallies: { yes: number; no: number; maybe: number };
  myVote: "yes" | "no" | "maybe" | null;
  assignments: Assignment[];
}

interface Assignment {
  id: string;
  respondent_id: string;
  room_label: string;
  nights: number;
  cost_owed_cents: number;
  payment_status: "unpaid" | "pending" | "paid";
}

const PLATFORM_LABEL: Record<string, string> = {
  airbnb: "Airbnb", vrbo: "VRBO", booking: "Booking.com", hotel: "Hotel", other: "Other",
};

export default function LodgingTab({
  tripId, tripTheme, destination, startDate, endDate,
  groupSizePrecise, groupSizeBucket,
  canManage, callerRespondentId, goingMembers,
  options: initialOptions,
}: {
  tripId: string;
  tripTheme: Trip["theme"];
  destination: string | null;
  startDate: string | null;
  endDate: string | null;
  groupSizePrecise: number | null;
  groupSizeBucket: string | null;
  canManage: boolean;
  callerRespondentId: string | null;
  goingMembers: GoingMember[];
  options: LodgingOptionView[];
}) {
  const router = useRouter();
  const [options, setOptions] = useState<LodgingOptionView[]>(initialOptions);
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState<string | null>(null);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [, startTrans] = useTransition();

  const t = themeClass(tripTheme);
  const hasOptions = options.length > 0;
  const selected = options.find((o) => o.status === "selected") ?? null;

  // Pre-filled "search more" links for the three big platforms.
  // Available regardless of whether AI has run — gives the planner
  // a manual fallback path with trip context baked in.
  const searchLinks = lodgingSearchSet({
    destination,
    start_date: startDate,
    end_date:   endDate,
    group_size_precise: groupSizePrecise,
    group_size_bucket:  groupSizeBucket,
  });
  const canSearchMore = Boolean(destination && startDate && endDate);

  async function suggest(regenerate: boolean) {
    setBusy(true);
    setErr(null);
    setAiNote(null);
    try {
      const res = await fetch(`/api/trips/${tripId}/lodging/suggest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ regenerate }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        setErr(body?.error?.message || body?.error?.code || `Generation failed (${res.status})`);
        return;
      }
      setAiNote(body.data.note ?? null);
      startTrans(() => router.refresh());
    } catch {
      setErr("Couldn't reach Rally. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function vote(optionId: string, choice: "yes" | "no" | "maybe") {
    if (!callerRespondentId) {
      setErr("You don't have an RSVP on this trip yet. Tap your name on the invite page to add yourself.");
      return;
    }
    setErr(null);
    setOptions((prev) =>
      prev.map((o) => {
        if (o.id !== optionId) return o;
        const tallies = { ...o.tallies };
        if (o.myVote) tallies[o.myVote] = Math.max(0, tallies[o.myVote] - 1);
        const newVote = o.myVote === choice ? null : choice;
        if (newVote) tallies[newVote]++;
        return { ...o, tallies, myVote: newVote };
      }),
    );
    try {
      const res = await fetch(`/api/trips/${tripId}/lodging/${optionId}/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vote: choice }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setErr(body?.error?.code || `Vote failed (${res.status})`);
        startTrans(() => router.refresh());
      }
    } catch {
      setErr("Couldn't reach Rally. Try again.");
      startTrans(() => router.refresh());
    }
  }

  async function select(optionId: string) {
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/trips/${tripId}/lodging/${optionId}/select`, {
        method: "POST",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setErr(body?.error?.code || `Select failed (${res.status})`);
        return;
      }
      startTrans(() => router.refresh());
    } catch {
      setErr("Couldn't reach Rally. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function assignMember(optionId: string, room_label: string, respondent_id: string, nights: number, cost_owed_cents: number) {
    setErr(null);
    try {
      const res = await fetch(`/api/trips/${tripId}/lodging/${optionId}/assignments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ respondent_id, room_label, nights, cost_owed_cents }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setErr(body?.error?.code || `Assign failed (${res.status})`);
        return;
      }
      startTrans(() => router.refresh());
    } catch {
      setErr("Couldn't reach Rally. Try again.");
    }
  }

  async function unassign(optionId: string, room_label: string, respondent_id: string) {
    setErr(null);
    try {
      const res = await fetch(`/api/trips/${tripId}/lodging/${optionId}/assignments`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ respondent_id, room_label }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setErr(body?.error?.code || `Unassign failed (${res.status})`);
        return;
      }
      startTrans(() => router.refresh());
    } catch {
      setErr("Couldn't reach Rally. Try again.");
    }
  }

  return (
    <div>
      {/* Toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <h2 className={`text-2xl ${t.display}`}>Lodging</h2>
        {canManage && (
          <div className="flex gap-2 flex-wrap">
            {hasOptions && (
              <button
                onClick={() => suggest(true)}
                disabled={busy}
                className={`h-10 px-4 rounded-full ${t.surface} text-ink border ${t.surfaceBorder} hover:border-green text-sm disabled:opacity-50`}
              >
                {busy ? "Regenerating…" : "Regenerate"}
              </button>
            )}
            {!hasOptions && (
              <button
                onClick={() => suggest(false)}
                disabled={busy || !destination || !startDate || !endDate}
                className="h-11 px-5 rounded-full bg-green text-cream font-bold hover:bg-green-2 text-sm disabled:opacity-50"
              >
                {busy ? "Finding…" : "Find lodging →"}
              </button>
            )}
          </div>
        )}
      </div>

      {err && <p className="text-orange text-sm mb-4">{err}</p>}
      {aiNote && <p className={`text-xs mb-4 italic ${t.meta}`}>{aiNote}</p>}

      {/* Pre-filled search-more links — destination + dates +
          group size carried into the host site's search form. */}
      {canSearchMore && (
        <div className={`mb-6 flex flex-wrap items-center gap-2 text-sm ${t.meta}`}>
          <span className="text-xs uppercase tracking-widest font-semibold">Search more:</span>
          <a
            href={searchLinks.airbnb}
            target="_blank"
            rel="noopener noreferrer"
            className={`h-9 px-3 rounded-full ${t.surface} border ${t.surfaceBorder} hover:border-green text-ink inline-flex items-center text-sm`}
          >
            Airbnb ↗
          </a>
          <a
            href={searchLinks.vrbo}
            target="_blank"
            rel="noopener noreferrer"
            className={`h-9 px-3 rounded-full ${t.surface} border ${t.surfaceBorder} hover:border-green text-ink inline-flex items-center text-sm`}
          >
            VRBO ↗
          </a>
          <a
            href={searchLinks.bookingCom}
            target="_blank"
            rel="noopener noreferrer"
            className={`h-9 px-3 rounded-full ${t.surface} border ${t.surfaceBorder} hover:border-green text-ink inline-flex items-center text-sm`}
          >
            Booking.com ↗
          </a>
        </div>
      )}

      {/* Empty state */}
      {!hasOptions && (
        <div className={`${t.surface} border ${t.surfaceBorder} rounded-2xl p-8 text-center`}>
          <p className={`mb-2 ${t.body}`}>No lodging options yet.</p>
          {canManage ? (
            (!destination || !startDate || !endDate) ? (
              <p className={`text-sm ${t.meta}`}>
                Set destination + start + end dates on the trip first.
              </p>
            ) : (
              <p className={`text-sm ${t.meta}`}>
                Tap &ldquo;Find lodging&rdquo; — Gemini grounds against real listings for your dates.
              </p>
            )
          ) : (
            <p className={`text-sm ${t.meta}`}>
              Once the host pulls suggestions, options will appear here.
            </p>
          )}
        </div>
      )}

      {/* Options */}
      <div className="grid gap-4">
        {options.map((o) => (
          <LodgingCard
            key={o.id}
            option={o}
            t={t}
            isSelected={o.status === "selected"}
            canManage={canManage}
            canVote={!!callerRespondentId}
            goingMembers={goingMembers}
            onVote={(c) => vote(o.id, c)}
            onSelect={() => select(o.id)}
            onAssign={(room, mem, nights, costCents) => assignMember(o.id, room, mem, nights, costCents)}
            onUnassign={(room, mem) => unassign(o.id, room, mem)}
            allAssignmentsBySelectedRoom={selected?.assignments ?? []}
          />
        ))}
      </div>

      {/* Splitwise nudge */}
      {selected && (
        <p className={`text-xs mt-6 text-center ${t.meta}`}>
          Rally tracks who owes what here; for actual settlement, link out to{" "}
          <a
            href="https://www.splitwise.com/"
            target="_blank" rel="noopener"
            className="underline"
          >Splitwise</a>.
        </p>
      )}
    </div>
  );
}

function LodgingCard({
  option, t, isSelected, canManage, canVote, goingMembers,
  onVote, onSelect, onAssign, onUnassign,
}: {
  option: LodgingOptionView;
  t: ReturnType<typeof themeClass>;
  isSelected: boolean;
  canManage: boolean;
  canVote: boolean;
  goingMembers: GoingMember[];
  onVote: (c: "yes" | "no" | "maybe") => void;
  onSelect: () => void;
  onAssign: (room: string, respondent_id: string, nights: number, cost_owed_cents: number) => void;
  onUnassign: (room: string, respondent_id: string) => void;
  allAssignmentsBySelectedRoom: Assignment[];
}) {
  const nightly = option.nightly_rate_cents != null ? Math.round(option.nightly_rate_cents / 100) : null;
  const total   = option.total_cost_cents   != null ? Math.round(option.total_cost_cents   / 100) : null;
  const total_voters = option.tallies.yes + option.tallies.maybe + option.tallies.no;

  return (
    <article
      className={`rounded-[18px] p-5 border ${
        isSelected
          ? "bg-green-soft border-green shadow-md"
          : `${t.surface} ${t.surfaceBorder}`
      }`}
    >
      <header className="flex items-start justify-between gap-3 flex-wrap mb-2">
        <div className="min-w-0 flex-1">
          <p className={`text-[10px] uppercase tracking-widest font-bold mb-1 ${t.meta}`}>
            {PLATFORM_LABEL[option.platform] ?? option.platform}
            {option.ai_suggested ? " · AI suggested" : ""}
            {isSelected ? " · LOCKED IN" : ""}
          </p>
          <h3 className={`font-bold text-lg ${t.body}`}>{option.title}</h3>
          {option.notes && <p className={`text-sm mt-1 ${t.body}`}>{option.notes}</p>}
        </div>
        <div className="flex gap-1 flex-shrink-0" role="group" aria-label="Vote">
          {(["yes", "maybe", "no"] as const).map((c) => {
            const active = option.myVote === c;
            const label = c === "yes" ? "👍" : c === "maybe" ? "🤷" : "👎";
            return (
              <button
                key={c}
                type="button"
                disabled={!canVote}
                onClick={() => onVote(c)}
                aria-label={`Vote ${c}`}
                aria-pressed={active}
                className={
                  "h-8 w-8 rounded-full inline-flex items-center justify-center text-base transition-colors " +
                  (active
                    ? "bg-green text-cream border border-green"
                    : `${t.surface} border ${t.surfaceBorder} hover:border-green disabled:opacity-50 disabled:cursor-not-allowed`)
                }
              >
                {label}
              </button>
            );
          })}
        </div>
      </header>

      {/* Cost + link */}
      <div className="flex items-center justify-between flex-wrap gap-3 mt-3">
        <div className={`text-sm ${t.body}`}>
          {nightly != null && <span><strong>${nightly.toLocaleString()}</strong>/night</span>}
          {total != null && <span className={t.meta}> · ${total.toLocaleString()} total</span>}
        </div>
        <div className="flex gap-2">
          {option.url && (
            <a
              href={option.url}
              target="_blank"
              rel="noopener"
              className={`h-9 px-4 rounded-full text-xs font-semibold inline-flex items-center ${t.surface} border ${t.surfaceBorder} hover:border-green`}
            >
              Open listing ↗
            </a>
          )}
          {canManage && !isSelected && (
            <button
              type="button"
              onClick={onSelect}
              className="h-9 px-4 rounded-full bg-green text-cream font-bold text-xs hover:bg-green-2"
            >
              Lock it in
            </button>
          )}
        </div>
      </div>

      {/* Vote tally */}
      {total_voters > 0 && (
        <p className={`text-[11px] mt-3 ${t.meta}`}>
          {option.tallies.yes} yes · {option.tallies.maybe} maybe · {option.tallies.no} no
        </p>
      )}

      {/* Room layout + assignments — only for the selected option */}
      {isSelected && option.room_layout && option.room_layout.length > 0 && (
        <section className="mt-5 pt-5 border-t border-green/30">
          <p className={`text-[10px] uppercase tracking-widest font-bold mb-3 ${t.meta}`}>
            Rooms · who's where
          </p>
          <div className="grid gap-3">
            {option.room_layout.map((rm) => (
              <RoomCard
                key={rm.room}
                room={rm}
                option={option}
                t={t}
                canManage={canManage}
                goingMembers={goingMembers}
                onAssign={(mem, nights, costCents) => onAssign(rm.room, mem, nights, costCents)}
                onUnassign={(mem) => onUnassign(rm.room, mem)}
              />
            ))}
          </div>
        </section>
      )}
    </article>
  );
}

function RoomCard({
  room, option, t, canManage, goingMembers, onAssign, onUnassign,
}: {
  room: { room: string; beds: string };
  option: LodgingOptionView;
  t: ReturnType<typeof themeClass>;
  canManage: boolean;
  goingMembers: GoingMember[];
  onAssign: (respondent_id: string, nights: number, cost_owed_cents: number) => void;
  onUnassign: (respondent_id: string) => void;
}) {
  const [memberToAdd, setMemberToAdd] = useState("");
  const assignedHere = option.assignments.filter((a) => a.room_label === room.room);
  const assignedIds = new Set(assignedHere.map((a) => a.respondent_id));
  const available = goingMembers.filter((m) => !assignedIds.has(m.id));

  // Total cost owed per room = nightly_rate × nights (rough — Phase B v0
  // assumes each room shares a flat per-room slice; finer-grained split
  // logic could come later).
  const totalCostCents = option.nightly_rate_cents != null
    ? option.nightly_rate_cents * Math.max(1, assignedHere[0]?.nights ?? 1)
    : 0;
  const perPersonCostCents = assignedHere.length > 0
    ? Math.round(totalCostCents / assignedHere.length / option.room_layout!.length)
    : null;

  return (
    <div className={`bg-cream border border-line/60 rounded-xl p-4`}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className={`font-bold ${t.body}`}>{room.room}</p>
          <p className={`text-xs ${t.meta}`}>{room.beds}</p>
        </div>
        {perPersonCostCents != null && perPersonCostCents > 0 && (
          <p className={`text-xs ${t.meta}`}>
            ~${Math.round(perPersonCostCents / 100).toLocaleString()}/person
          </p>
        )}
      </div>

      {assignedHere.length > 0 && (
        <ul className="mt-3 grid gap-1.5">
          {assignedHere.map((a) => {
            const member = goingMembers.find((m) => m.id === a.respondent_id);
            return (
              <li key={a.id} className="flex items-center justify-between text-sm">
                <span className={t.body}>{member?.name ?? "(left the trip)"}</span>
                {canManage && (
                  <button
                    type="button"
                    onClick={() => onUnassign(a.respondent_id)}
                    className={`text-xs ${t.meta} hover:text-orange`}
                  >
                    Remove
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {canManage && available.length > 0 && (
        <div className="mt-3 flex gap-2 flex-wrap items-center">
          <select
            value={memberToAdd}
            onChange={(e) => setMemberToAdd(e.target.value)}
            className={`h-9 px-3 rounded-full bg-cream border ${t.surfaceBorder} text-sm`}
          >
            <option value="">Add someone…</option>
            {available.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
          <button
            type="button"
            disabled={!memberToAdd}
            onClick={() => {
              if (!memberToAdd) return;
              // Default nights = full trip; cost = nightly × nights, split N ways at read-time
              onAssign(memberToAdd, 1, option.nightly_rate_cents ?? 0);
              setMemberToAdd("");
            }}
            className="h-9 px-4 rounded-full bg-green text-cream font-bold text-xs hover:bg-green-2 disabled:opacity-50"
          >
            Add
          </button>
        </div>
      )}
    </div>
  );
}
