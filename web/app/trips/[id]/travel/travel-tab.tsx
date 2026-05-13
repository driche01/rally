"use client";

/**
 * Travel tab — per-member arrangements + flight suggest + car groupings.
 * Phase B Step 6 v0.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { themeClass } from "@/lib/themes";
import { flightSearchFor } from "@/lib/deep-links";
import type { Trip } from "@shared/types";

export interface TravelMember {
  respondent_id: string;
  name: string;
  is_planner: boolean;
  home_airport: string | null;
  arrangement: Arrangement | null;
}

interface Arrangement {
  arrival_mode: string | null;
  arrival_datetime: string | null;
  departure_datetime: string | null;
  flight_number: string | null;
  flight_origin_airport: string | null;
  flight_destination_airport: string | null;
  vehicle_capacity: number | null;
  gear_notes: string | null;
}

export interface GroupingView {
  id: string;
  direction: "outbound" | "return";
  departure_datetime: string;
  driver_respondent_id: string | null;
  notes: string | null;
  member_respondent_ids: string[];
}

interface FlightOption {
  airline: string;
  flight_numbers?: string[];
  origin_airport: string;
  destination_airport: string;
  depart_local: string;
  arrive_local: string;
  stops: number;
  duration_minutes: number;
  price_usd: number;
  booking_url: string;
  notes?: string;
}

export default function TravelTab({
  tripId, tripTheme, destination, startDate, endDate,
  canManage, members, groupings,
}: {
  tripId: string;
  tripTheme: Trip["theme"];
  destination: string | null;
  startDate: string | null;
  endDate: string | null;
  canManage: boolean;
  members: TravelMember[];
  groupings: GroupingView[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [suggestionsFor, setSuggestionsFor] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<FlightOption[] | null>(null);
  const [suggestionsNote, setSuggestionsNote] = useState<string | null>(null);
  const [, startTrans] = useTransition();

  const t = themeClass(tripTheme);

  async function saveArrangement(
    respondent_id: string,
    fields: Partial<Arrangement>,
  ) {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/trips/${tripId}/travel/arrangements`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ respondent_id, ...fields }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        setErr(body?.error?.message || body?.error?.code || `Save failed (${res.status})`);
        return;
      }
      setEditing(null);
      startTrans(() => router.refresh());
    } catch {
      setErr("Couldn't reach Rally. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function suggestFlights(respondent_id: string) {
    setBusy(true);
    setErr(null);
    setSuggestions(null);
    setSuggestionsFor(respondent_id);
    try {
      const res = await fetch(`/api/trips/${tripId}/travel/suggest-flights`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ respondent_id }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        setErr(body?.error?.message || body?.error?.code || `Suggest failed (${res.status})`);
        setSuggestionsFor(null);
        return;
      }
      setSuggestions(body.data.options as FlightOption[]);
      setSuggestionsNote(body.data.note ?? null);
    } catch {
      setErr("Couldn't reach Rally. Try again.");
      setSuggestionsFor(null);
    } finally {
      setBusy(false);
    }
  }

  async function createGrouping(direction: "outbound" | "return", departure_datetime: string) {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/trips/${tripId}/travel/groupings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ direction, departure_datetime }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setErr(body?.error?.code || `Create failed (${res.status})`);
        return;
      }
      startTrans(() => router.refresh());
    } catch {
      setErr("Couldn't reach Rally. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleGroupingMember(grouping_id: string, respondent_id: string, currently_in: boolean) {
    setErr(null);
    try {
      const res = await fetch(`/api/trips/${tripId}/travel/groupings/${grouping_id}/members`, {
        method: currently_in ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ respondent_id }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setErr(body?.error?.code || `Update failed (${res.status})`);
        return;
      }
      startTrans(() => router.refresh());
    } catch {
      setErr("Couldn't reach Rally. Try again.");
    }
  }

  async function deleteGrouping(grouping_id: string) {
    if (!confirm("Remove this ride share grouping?")) return;
    setErr(null);
    try {
      const res = await fetch(`/api/trips/${tripId}/travel/groupings`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grouping_id }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setErr(body?.error?.code || `Delete failed (${res.status})`);
        return;
      }
      startTrans(() => router.refresh());
    } catch {
      setErr("Couldn't reach Rally. Try again.");
    }
  }

  return (
    <div>
      <h2 className={`text-2xl mb-6 ${t.display}`}>Travel</h2>
      {err && <p className="text-orange text-sm mb-4">{err}</p>}

      {/* Members */}
      <section className="mb-10">
        <h3 className={`text-xs mb-3 ${t.eyebrow}`}>Who&apos;s arriving when</h3>
        {members.length === 0 ? (
          <div className={`${t.surface} border ${t.surfaceBorder} rounded-2xl p-6 text-center`}>
            <p className={`text-sm ${t.meta}`}>
              No one&apos;s going yet. Invite friends and have them RSVP first.
            </p>
          </div>
        ) : (
          <ul className="grid gap-3">
            {members.map((m) => (
              <li key={m.respondent_id}>
                <MemberCard
                  member={m}
                  trip={{ destination, start_date: startDate, end_date: endDate }}
                  t={t}
                  canManage={canManage}
                  isEditing={editing === m.respondent_id}
                  busy={busy}
                  onEdit={() => setEditing(m.respondent_id)}
                  onCancel={() => setEditing(null)}
                  onSave={(fields) => saveArrangement(m.respondent_id, fields)}
                  onSuggestFlights={() => suggestFlights(m.respondent_id)}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Flight suggestion modal-ish panel */}
      {suggestionsFor && suggestions && (
        <FlightSuggestionsPanel
          memberName={members.find((m) => m.respondent_id === suggestionsFor)?.name ?? "this person"}
          options={suggestions}
          note={suggestionsNote}
          t={t}
          onClose={() => { setSuggestionsFor(null); setSuggestions(null); }}
        />
      )}

      {/* Groupings */}
      <section className="mb-10">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
          <h3 className={`text-xs ${t.eyebrow}`}>Ride shares</h3>
          {canManage && (
            <CreateGroupingForm onSubmit={createGrouping} busy={busy} t={t}
              defaultDepart={startDate ? `${startDate}T08:00` : ""} />
          )}
        </div>
        {groupings.length === 0 ? (
          <p className={`text-sm ${t.meta}`}>
            No ride shares yet. {canManage ? "Add one above to start grouping members by departure time." : ""}
          </p>
        ) : (
          <ul className="grid gap-3">
            {groupings.map((g) => (
              <li key={g.id}>
                <GroupingCard
                  grouping={g}
                  members={members}
                  t={t}
                  canManage={canManage}
                  onToggleMember={(memId, inGroup) => toggleGroupingMember(g.id, memId, inGroup)}
                  onDelete={() => deleteGrouping(g.id)}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function MemberCard({
  member, trip, t, canManage, isEditing, busy,
  onEdit, onCancel, onSave, onSuggestFlights,
}: {
  member: TravelMember;
  trip: { destination: string | null; start_date: string | null; end_date: string | null };
  t: ReturnType<typeof themeClass>;
  canManage: boolean;
  isEditing: boolean;
  busy: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: (fields: Partial<Arrangement>) => void;
  onSuggestFlights: () => void;
}) {
  const a = member.arrangement;

  if (isEditing) {
    return (
      <EditArrangementForm
        member={member}
        t={t}
        busy={busy}
        onCancel={onCancel}
        onSave={onSave}
      />
    );
  }

  return (
    <article className={`${t.surface} border ${t.surfaceBorder} rounded-2xl p-4`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <p className={`font-bold ${t.body}`}>
            {member.name}
            {member.is_planner && (
              <span className="ml-2 text-[10px] uppercase tracking-widest font-bold text-gold">
                host
              </span>
            )}
          </p>
          {a ? (
            <div className={`text-sm ${t.body} mt-1 grid gap-0.5`}>
              {a.arrival_mode === "flight" && a.flight_number ? (
                <p>
                  ✈️ {a.flight_number}
                  {a.flight_origin_airport && a.flight_destination_airport ? (
                    <> · {a.flight_origin_airport} → {a.flight_destination_airport}</>
                  ) : null}
                </p>
              ) : a.arrival_mode === "drive" ? (
                <p>🚗 Driving{a.vehicle_capacity ? ` · ${a.vehicle_capacity} seats` : ""}</p>
              ) : a.arrival_mode === "train" ? (
                <p>🚆 Train</p>
              ) : a.arrival_mode ? (
                <p>{a.arrival_mode}</p>
              ) : null}
              {a.arrival_datetime && (
                <p className={`text-xs ${t.meta}`}>
                  Arrives {formatDt(a.arrival_datetime)}
                </p>
              )}
              {a.departure_datetime && (
                <p className={`text-xs ${t.meta}`}>
                  Leaves {formatDt(a.departure_datetime)}
                </p>
              )}
              {a.gear_notes && (
                <p className={`text-xs mt-1 ${t.body}`}>{a.gear_notes}</p>
              )}
            </div>
          ) : (
            <p className={`text-sm ${t.meta} mt-1`}>
              No arrangement set yet
              {member.home_airport ? ` · home: ${member.home_airport}` : ""}
            </p>
          )}
        </div>
        <div className="flex gap-2 flex-wrap">
          {canManage && member.home_airport && (
            <button
              onClick={onSuggestFlights}
              className={`h-9 px-3 rounded-full ${t.surface} border ${t.surfaceBorder} text-xs hover:border-green`}
            >
              Suggest flights
            </button>
          )}
          {member.home_airport && trip.destination && trip.start_date && trip.end_date && (
            <a
              href={flightSearchFor(member.home_airport, trip)}
              target="_blank"
              rel="noopener noreferrer"
              className={`h-9 px-3 rounded-full ${t.surface} border ${t.surfaceBorder} text-xs hover:border-green inline-flex items-center text-ink`}
              title={`Search Google Flights ${member.home_airport} → ${trip.destination}`}
            >
              Search flights ↗
            </a>
          )}
          {canManage && (
            <button
              onClick={onEdit}
              className={`h-9 px-3 rounded-full ${t.surface} border ${t.surfaceBorder} text-xs hover:border-green`}
            >
              {a ? "Edit" : "Add"}
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

function EditArrangementForm({
  member, t, busy, onCancel, onSave,
}: {
  member: TravelMember;
  t: ReturnType<typeof themeClass>;
  busy: boolean;
  onCancel: () => void;
  onSave: (fields: Partial<Arrangement>) => void;
}) {
  const a = member.arrangement;
  const [mode, setMode] = useState(a?.arrival_mode ?? "flight");
  const [flightNumber, setFlightNumber] = useState(a?.flight_number ?? "");
  const [origin, setOrigin] = useState(a?.flight_origin_airport ?? member.home_airport ?? "");
  const [dest, setDest] = useState(a?.flight_destination_airport ?? "");
  const [arrive, setArrive] = useState(a?.arrival_datetime ?? "");
  const [depart, setDepart] = useState(a?.departure_datetime ?? "");
  const [capacity, setCapacity] = useState<string>(a?.vehicle_capacity != null ? String(a.vehicle_capacity) : "");
  const [notes, setNotes] = useState(a?.gear_notes ?? "");

  function submit() {
    onSave({
      arrival_mode: mode || null,
      flight_number: flightNumber.trim() || null,
      flight_origin_airport: origin.trim() || null,
      flight_destination_airport: dest.trim() || null,
      arrival_datetime: arrive || null,
      departure_datetime: depart || null,
      vehicle_capacity: capacity ? Math.max(0, parseInt(capacity, 10)) : null,
      gear_notes: notes.trim() || null,
    });
  }

  return (
    <article className={`${t.surface} border-2 border-green rounded-2xl p-4 grid gap-3`}>
      <p className={`font-bold ${t.body}`}>{member.name}</p>

      <label className="grid gap-1.5">
        <span className={`text-[10px] uppercase tracking-widest font-bold ${t.meta}`}>Mode</span>
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value)}
          className={`h-10 px-3 rounded-xl bg-cream border ${t.surfaceBorder} text-sm`}
        >
          <option value="flight">Flight</option>
          <option value="drive">Drive</option>
          <option value="train">Train</option>
          <option value="other">Other</option>
        </select>
      </label>

      {mode === "flight" && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Flight number" t={t}>
            <input type="text" value={flightNumber} onChange={(e) => setFlightNumber(e.target.value)}
              placeholder="AA123" className={inputCls(t)} />
          </Field>
          <Field label="From" t={t}>
            <input type="text" value={origin} onChange={(e) => setOrigin(e.target.value.toUpperCase())}
              placeholder="JFK" maxLength={5} className={inputCls(t)} />
          </Field>
          <Field label="To" t={t}>
            <input type="text" value={dest} onChange={(e) => setDest(e.target.value.toUpperCase())}
              placeholder="CUN" maxLength={5} className={inputCls(t)} />
          </Field>
        </div>
      )}

      {mode === "drive" && (
        <Field label="Seats available" t={t}>
          <input type="number" min={0} value={capacity} onChange={(e) => setCapacity(e.target.value)}
            placeholder="4" className={inputCls(t)} />
        </Field>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Arrival" t={t}>
          <input type="datetime-local" value={arrive} onChange={(e) => setArrive(e.target.value)}
            className={inputCls(t)} />
        </Field>
        <Field label="Departure" t={t}>
          <input type="datetime-local" value={depart} onChange={(e) => setDepart(e.target.value)}
            className={inputCls(t)} />
        </Field>
      </div>

      <Field label="Notes" t={t}>
        <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)}
          placeholder="Gear, dietary needs for the ride, etc."
          className={inputCls(t) + " min-h-16 py-2"} />
      </Field>

      <div className="flex gap-2 justify-end">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className={`h-10 px-4 rounded-full ${t.surface} text-muted border ${t.surfaceBorder} text-sm`}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="h-10 px-5 rounded-full bg-green text-cream font-bold text-sm hover:bg-green-2 disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </article>
  );
}

function FlightSuggestionsPanel({
  memberName, options, note, t, onClose,
}: {
  memberName: string;
  options: FlightOption[];
  note: string | null;
  t: ReturnType<typeof themeClass>;
  onClose: () => void;
}) {
  return (
    <section className={`${t.surface} border ${t.surfaceBorder} rounded-2xl p-5 mb-10`}>
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <h3 className={`text-xs ${t.eyebrow}`}>
          Flight options for {memberName}
        </h3>
        <button onClick={onClose} className={`text-xs ${t.meta} hover:text-ink`}>Close</button>
      </div>
      {note && <p className={`text-xs italic ${t.meta} mb-3`}>{note}</p>}
      <ul className="grid gap-2">
        {options.map((o, i) => (
          <li key={i} className="bg-cream border border-line/60 rounded-xl p-3">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <p className={`font-bold ${t.body}`}>
                  {o.airline} {o.flight_numbers?.join(" + ") ?? ""}
                </p>
                <p className={`text-xs ${t.meta}`}>
                  {o.origin_airport} → {o.destination_airport} · {fmtTime(o.depart_local)} → {fmtTime(o.arrive_local)} · {o.stops === 0 ? "non-stop" : `${o.stops} stop${o.stops === 1 ? "" : "s"}`} · {Math.floor(o.duration_minutes / 60)}h {o.duration_minutes % 60}m
                </p>
                {o.notes && <p className={`text-xs mt-1 ${t.body}`}>{o.notes}</p>}
              </div>
              <div className="text-right flex-shrink-0">
                <p className={`font-bold ${t.body}`}>${Math.round(o.price_usd).toLocaleString()}</p>
                <a
                  href={o.booking_url}
                  target="_blank"
                  rel="noopener"
                  className={`text-xs ${t.eyebrow} underline`}
                >
                  Book ↗
                </a>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function CreateGroupingForm({
  onSubmit, busy, t, defaultDepart,
}: {
  onSubmit: (dir: "outbound" | "return", dt: string) => void;
  busy: boolean;
  t: ReturnType<typeof themeClass>;
  defaultDepart: string;
}) {
  const [direction, setDirection] = useState<"outbound" | "return">("outbound");
  const [departure, setDeparture] = useState(defaultDepart);
  return (
    <div className="flex gap-2 flex-wrap items-center">
      <select
        value={direction}
        onChange={(e) => setDirection(e.target.value as "outbound" | "return")}
        className={`h-9 px-2 rounded-full bg-cream border ${t.surfaceBorder} text-xs`}
      >
        <option value="outbound">Outbound</option>
        <option value="return">Return</option>
      </select>
      <input
        type="datetime-local"
        value={departure}
        onChange={(e) => setDeparture(e.target.value)}
        className={`h-9 px-2 rounded-full bg-cream border ${t.surfaceBorder} text-xs`}
      />
      <button
        type="button"
        disabled={busy || !departure}
        onClick={() => onSubmit(direction, departure)}
        className="h-9 px-3 rounded-full bg-green text-cream font-bold text-xs hover:bg-green-2 disabled:opacity-50"
      >
        + Add
      </button>
    </div>
  );
}

function GroupingCard({
  grouping, members, t, canManage, onToggleMember, onDelete,
}: {
  grouping: GroupingView;
  members: TravelMember[];
  t: ReturnType<typeof themeClass>;
  canManage: boolean;
  onToggleMember: (memId: string, inGroup: boolean) => void;
  onDelete: () => void;
}) {
  const inGroupIds = new Set(grouping.member_respondent_ids);

  return (
    <article className={`${t.surface} border ${t.surfaceBorder} rounded-2xl p-4`}>
      <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
        <div>
          <p className={`text-[10px] uppercase tracking-widest font-bold ${t.meta}`}>
            {grouping.direction === "outbound" ? "Outbound" : "Return"}
          </p>
          <p className={`font-bold ${t.body}`}>{formatDt(grouping.departure_datetime)}</p>
          {grouping.notes && <p className={`text-xs ${t.meta}`}>{grouping.notes}</p>}
        </div>
        {canManage && (
          <button onClick={onDelete} className={`text-xs ${t.meta} hover:text-orange`}>
            Remove
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {members.map((m) => {
          const inGroup = inGroupIds.has(m.respondent_id);
          return (
            <button
              key={m.respondent_id}
              type="button"
              disabled={!canManage}
              onClick={() => onToggleMember(m.respondent_id, inGroup)}
              className={
                "h-8 px-3 rounded-full text-xs font-semibold border transition-colors " +
                (inGroup
                  ? "bg-green text-cream border-green"
                  : `bg-cream ${t.surfaceBorder} text-ink hover:border-green disabled:opacity-50`)
              }
            >
              {m.name}
            </button>
          );
        })}
      </div>
    </article>
  );
}

// ─── Helpers ──────────────────────────────────────────────────

function Field({ label, t, children }: { label: string; t: ReturnType<typeof themeClass>; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className={`text-[10px] uppercase tracking-widest font-bold ${t.meta}`}>{label}</span>
      {children}
    </label>
  );
}
function inputCls(t: ReturnType<typeof themeClass>) {
  return `h-10 px-3 rounded-xl bg-cream border ${t.surfaceBorder} text-sm focus:border-green focus:outline-none`;
}

function formatDt(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
