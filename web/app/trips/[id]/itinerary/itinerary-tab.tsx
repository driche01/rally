"use client";

/**
 * Itinerary tab — day-by-day timeline with vote buttons + tallies.
 *
 * v0 scope (build guide §5 Step 4):
 *   - Generate button (planner/cohost) → POST /api/.../generate
 *   - Render items grouped by day, sorted by start_time
 *   - Vote yes/no/maybe per item (live optimistic update)
 *   - Show vote tallies + my own current vote
 *   - Empty state with "Generate" CTA when no items
 *
 * Deferred (Phase B Step 4 follow-up):
 *   - Manual add / edit / delete UI
 *   - "Alternatives" A-vs-B grouping
 *   - Real-time updates via Supabase realtime
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { themeClass } from "@/lib/themes";
import type { Trip } from "@shared/types";

export interface ItineraryItemWithVotes {
  id: string;
  trip_id: string;
  day_date: string;
  type: string;
  title: string;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  notes: string | null;
  location_url: string | null;
  position: number;
  ai_generated: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  tallies: { yes: number; no: number; maybe: number };
  myVote: "yes" | "no" | "maybe" | null;
}

const TYPE_LABEL: Record<string, string> = {
  activity:      "Activity",
  meal:          "Meal",
  free_time:     "Free time",
  lodging:       "Lodging",
  accommodation: "Lodging",
  transit:       "Transit",
  travel:        "Travel",
  other:         "Other",
};

export default function ItineraryTab({
  tripId,
  tripTheme,
  startDate,
  endDate,
  canGenerate,
  items: initialItems,
  callerRespondentId,
}: {
  tripId: string;
  tripTheme: Trip["theme"];
  startDate: string | null;
  endDate: string | null;
  canGenerate: boolean;
  items: ItineraryItemWithVotes[];
  callerRespondentId: string | null;
}) {
  const router = useRouter();
  const [items, setItems] = useState<ItineraryItemWithVotes[]>(initialItems);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [, startTrans] = useTransition();

  const t = themeClass(tripTheme);

  async function generate(regenerate: boolean) {
    setBusy(true);
    setErr(null);
    setAiNote(null);
    try {
      const res = await fetch(`/api/trips/${tripId}/itinerary/generate`, {
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
      // Refresh server data so the page picks up vote rows + ordering.
      startTrans(() => { router.refresh(); });
    } catch {
      setErr("Couldn't reach Rally. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function vote(itemId: string, choice: "yes" | "no" | "maybe") {
    if (!callerRespondentId) {
      // The planner doesn't have a respondent row on their own trip
      // until they self-RSVP (or until the planner-row trigger kicks
      // in). For Phase B Step 4, surface this rather than fail silently.
      setErr("You don't have an RSVP on this trip yet. Tap your name on the invite page to add yourself.");
      return;
    }
    setErr(null);
    // Optimistic update.
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== itemId) return it;
        const tallies = { ...it.tallies };
        if (it.myVote) tallies[it.myVote] = Math.max(0, tallies[it.myVote] - 1);
        const newVote = it.myVote === choice ? null : choice;
        if (newVote) tallies[newVote]++;
        return { ...it, tallies, myVote: newVote };
      }),
    );

    try {
      const res = await fetch(`/api/trips/${tripId}/itinerary/${itemId}/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vote: choice }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setErr(body?.error?.code || `Vote failed (${res.status})`);
        // Revert optimistic — refetch from server.
        startTrans(() => { router.refresh(); });
      }
    } catch {
      setErr("Couldn't reach Rally. Try again.");
      startTrans(() => { router.refresh(); });
    }
  }

  const byDay = groupByDay(items);
  const hasItems = items.length > 0;

  return (
    <div>
      {/* Toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <h2 className={`text-2xl ${t.display}`}>Itinerary</h2>
        {canGenerate && (
          <div className="flex gap-2 flex-wrap">
            {hasItems && (
              <button
                onClick={() => generate(true)}
                disabled={busy}
                className={`h-10 px-4 rounded-full ${t.surface} text-ink border ${t.surfaceBorder} hover:border-green text-sm disabled:opacity-50`}
              >
                {busy ? "Regenerating…" : "Regenerate"}
              </button>
            )}
            {!hasItems && (
              <button
                onClick={() => generate(false)}
                disabled={busy || !startDate || !endDate}
                className="h-11 px-5 rounded-full bg-green text-cream font-bold hover:bg-green-2 text-sm disabled:opacity-50"
              >
                {busy ? "Generating…" : "Generate itinerary →"}
              </button>
            )}
          </div>
        )}
      </div>

      {err && <p className="text-orange text-sm mb-4">{err}</p>}
      {aiNote && (
        <p className={`text-xs mb-4 italic ${t.meta}`}>{aiNote}</p>
      )}

      {/* Empty state */}
      {!hasItems && (
        <div className={`${t.surface} border ${t.surfaceBorder} rounded-2xl p-8 text-center`}>
          <p className={`mb-2 ${t.body}`}>No itinerary yet.</p>
          {canGenerate ? (
            (!startDate || !endDate) ? (
              <p className={`text-sm ${t.meta}`}>
                Set start + end dates on the trip first — AI generation needs the date range.
              </p>
            ) : (
              <p className={`text-sm ${t.meta}`}>
                Tap &ldquo;Generate itinerary&rdquo; to draft a day-by-day plan from your group&apos;s profiles.
              </p>
            )
          ) : (
            <p className={`text-sm ${t.meta}`}>
              Once the host generates an itinerary, items will appear here.
            </p>
          )}
        </div>
      )}

      {/* Day-by-day */}
      <div className="grid gap-6">
        {byDay.map(({ day, items }) => (
          <section key={day}>
            <h3 className={`text-xs mb-3 ${t.eyebrow}`}>
              {formatDayHeading(day)}
            </h3>
            <ul className="grid gap-2">
              {items.map((it) => (
                <ItineraryItemCard
                  key={it.id}
                  item={it}
                  t={t}
                  canVote={!!callerRespondentId}
                  onVote={(c) => vote(it.id, c)}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

function ItineraryItemCard({
  item, t, canVote, onVote,
}: {
  item: ItineraryItemWithVotes;
  t: ReturnType<typeof themeClass>;
  canVote: boolean;
  onVote: (vote: "yes" | "no" | "maybe") => void | Promise<void>;
}) {
  const total = item.tallies.yes + item.tallies.no + item.tallies.maybe;
  return (
    <li className={`${t.surface} border ${t.surfaceBorder} rounded-2xl p-4`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <p className={`text-[10px] uppercase tracking-widest font-bold mb-1 ${t.meta}`}>
            {(item.start_time ? formatTime(item.start_time) + " · " : "")}
            {TYPE_LABEL[item.type] ?? item.type}
            {item.ai_generated ? " · AI draft" : ""}
          </p>
          <p className={`font-bold ${t.body}`}>{item.title}</p>
          {item.location && (
            <p className={`text-sm ${t.meta}`}>{item.location}</p>
          )}
          {item.notes && (
            <p className={`text-sm mt-1 ${t.body}`}>{item.notes}</p>
          )}
        </div>
        <VoteCluster item={item} canVote={canVote} onVote={onVote} t={t} />
      </div>
      {total > 0 && (
        <p className={`text-[11px] mt-3 ${t.meta}`}>
          {item.tallies.yes} yes · {item.tallies.maybe} maybe · {item.tallies.no} no
        </p>
      )}
    </li>
  );
}

function VoteCluster({
  item, canVote, onVote, t,
}: {
  item: ItineraryItemWithVotes;
  canVote: boolean;
  onVote: (vote: "yes" | "no" | "maybe") => void | Promise<void>;
  t: ReturnType<typeof themeClass>;
}) {
  return (
    <div className="flex gap-1 flex-shrink-0" role="group" aria-label="Vote">
      {(["yes", "maybe", "no"] as const).map((choice) => {
        const active = item.myVote === choice;
        const label = choice === "yes" ? "👍" : choice === "maybe" ? "🤷" : "👎";
        return (
          <button
            key={choice}
            type="button"
            disabled={!canVote}
            onClick={() => onVote(choice)}
            aria-label={`Vote ${choice}`}
            aria-pressed={active}
            title={canVote ? `Vote ${choice}` : "Add yourself to the trip first"}
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
  );
}

function groupByDay(items: ItineraryItemWithVotes[]) {
  const map = new Map<string, ItineraryItemWithVotes[]>();
  for (const it of items) {
    const arr = map.get(it.day_date) ?? [];
    arr.push(it);
    map.set(it.day_date, arr);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, items]) => ({ day, items }));
}

function formatDayHeading(day: string): string {
  return new Date(day + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "long", month: "short", day: "numeric",
  });
}

function formatTime(t: string): string {
  // "14:30" → "2:30 PM"
  const m = /^(\d{2}):(\d{2})/.exec(t);
  if (!m) return t;
  const h = parseInt(m[1]!, 10);
  const min = m[2];
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${min} ${ampm}`;
}
