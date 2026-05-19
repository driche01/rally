"use client";

/**
 * Travel tab — per-member arrangements + flight suggest + car groupings.
 * Phase B Step 6 v0.
 */

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { themeClass } from "@/lib/themes";
import { flightSearchFor } from "@/lib/deep-links";
import TravelLoadingDance from "@/lib/generation/loading-art";
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

export interface GroupingMemberView {
  respondent_id: string;
  pre_assigned: boolean;
}

export type SpaceComfort = "tight" | "comfortable" | "spacious";

export interface GroupingView {
  id: string;
  direction: "outbound" | "return";
  departure_datetime: string;
  driver_respondent_id: string | null;
  notes: string | null;
  seats_total: number | null;
  space_comfort: SpaceComfort | null;
  ride_notes: string | null;
  members: GroupingMemberView[];
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
  canManage, callerRespondentId, members, groupings,
}: {
  tripId: string;
  tripTheme: Trip["theme"];
  destination: string | null;
  startDate: string | null;
  endDate: string | null;
  canManage: boolean;
  callerRespondentId: string | null;
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

  async function createGrouping(
    direction: "outbound" | "return",
    departure_datetime: string,
    extras: { driver_respondent_id?: string | null; seats_total?: number | null; space_comfort?: SpaceComfort | null; ride_notes?: string | null } = {},
  ) {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/trips/${tripId}/travel/groupings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          direction,
          departure_datetime,
          driver_respondent_id: extras.driver_respondent_id ?? null,
          seats_total: extras.seats_total ?? null,
          space_comfort: extras.space_comfort ?? null,
          ride_notes: extras.ride_notes ?? null,
        }),
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

  async function patchGrouping(
    grouping_id: string,
    patch: Partial<Pick<GroupingView, "seats_total" | "space_comfort" | "ride_notes" | "notes" | "departure_datetime" | "driver_respondent_id">>,
  ): Promise<boolean> {
    setErr(null);
    try {
      const res = await fetch(`/api/trips/${tripId}/travel/groupings/${grouping_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setErr(body?.error?.code || `Update failed (${res.status})`);
        return false;
      }
      startTrans(() => router.refresh());
      return true;
    } catch {
      setErr("Couldn't reach Rally. Try again.");
      return false;
    }
  }

  async function preAssignMember(grouping_id: string, respondent_id: string) {
    setErr(null);
    try {
      const res = await fetch(`/api/trips/${tripId}/travel/groupings/${grouping_id}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ respondent_id, pre_assigned: true }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setErr(body?.error?.code || `Add failed (${res.status})`);
        return;
      }
      startTrans(() => router.refresh());
    } catch {
      setErr("Couldn't reach Rally. Try again.");
    }
  }

  async function removeMember(grouping_id: string, respondent_id: string) {
    setErr(null);
    try {
      const res = await fetch(`/api/trips/${tripId}/travel/groupings/${grouping_id}/members`, {
        method: "DELETE",
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

  async function joinRide(grouping_id: string) {
    setErr(null);
    try {
      const res = await fetch(`/api/trips/${tripId}/travel/groupings/${grouping_id}/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setErr(body?.error?.code || `Couldn't join (${res.status})`);
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

      {/* Flight suggestion panel — shows a loading state (travel-emoji
          dance + caption) while the Gemini call is in flight, then
          swaps to the results panel when suggestions arrive. */}
      {suggestionsFor && !suggestions && (
        <FlightSuggestionsLoading
          memberName={members.find((m) => m.respondent_id === suggestionsFor)?.name ?? "this person"}
          t={t}
          onClose={() => { setSuggestionsFor(null); setSuggestions(null); setSuggestionsNote(null); }}
        />
      )}
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
              defaultDepart={startDate ? `${startDate}T08:00` : ""}
              drivers={members.filter((m) => m.arrangement?.arrival_mode === "drive")} />
          )}
        </div>

        {/* Driver bootstrap: callers whose own arrangement is "drive"
            with a capacity can one-shot create their outbound ride. */}
        {callerRespondentId && (() => {
          const me = members.find((m) => m.respondent_id === callerRespondentId);
          const drivesOut = me?.arrangement?.arrival_mode === "drive";
          const hasOutbound = groupings.some(
            (g) => g.direction === "outbound" && g.driver_respondent_id === callerRespondentId,
          );
          if (!drivesOut || hasOutbound) return null;
          return (
            <div className={`${t.surface} border ${t.surfaceBorder} rounded-2xl p-4 mb-4`}>
              <p className={`text-sm ${t.body} mb-2`}>
                You&rsquo;re driving. Want to offer your car as a ride share?
              </p>
              <button
                onClick={() =>
                  createGrouping("outbound",
                    startDate ? `${startDate}T08:00:00` : new Date().toISOString(),
                    {
                      driver_respondent_id: callerRespondentId,
                      seats_total: me?.arrangement?.vehicle_capacity ?? null,
                    })
                }
                disabled={busy}
                className="h-10 px-4 rounded-full bg-green text-cream font-bold text-sm hover:bg-green-2 disabled:opacity-50"
              >
                Make this a ride share →
              </button>
            </div>
          );
        })()}

        {groupings.length === 0 ? (
          <p className={`text-sm ${t.meta}`}>
            No ride shares yet.{canManage ? " Add one above to start grouping members by departure time." : ""}
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
                  callerRespondentId={callerRespondentId}
                  onPatch={(patch) => patchGrouping(g.id, patch)}
                  onPreAssign={(memId) => preAssignMember(g.id, memId)}
                  onRemoveMember={(memId) => removeMember(g.id, memId)}
                  onJoin={() => joinRide(g.id)}
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
      {/* Mobile: stack the card contents — name + arrangement on top,
          action pills as a horizontal-scrolling strip below. The old
          `flex justify-between flex-wrap` layout squeezed the left
          column so narrow that "No arrangement set yet" wrapped one
          word per line and the right-hand pills overlapped the card
          text (#9). sm+ keeps the original side-by-side layout. */}
      <div className="grid gap-3 sm:flex sm:items-start sm:justify-between sm:gap-3 sm:flex-wrap">
        <div className="min-w-0 sm:flex-1">
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
        <div className="-mx-4 sm:mx-0 px-4 sm:px-0 overflow-x-auto sm:overflow-visible">
          <div className="flex gap-2 sm:flex-wrap flex-nowrap">
            {canManage && member.home_airport && (
              <button
                onClick={onSuggestFlights}
                className={`h-9 px-3 rounded-full ${t.surface} border ${t.surfaceBorder} text-xs hover:border-green whitespace-nowrap flex-shrink-0`}
              >
                Suggest flights
              </button>
            )}
            {member.home_airport && trip.destination && trip.start_date && trip.end_date && (
              <a
                href={flightSearchFor(member.home_airport, trip)}
                target="_blank"
                rel="noopener noreferrer"
                className={`h-9 px-3 rounded-full ${t.surface} border ${t.surfaceBorder} text-xs hover:border-green inline-flex items-center text-ink whitespace-nowrap flex-shrink-0`}
                title={`Search Google Flights ${member.home_airport} → ${trip.destination}`}
              >
                Search flights ↗
              </a>
            )}
            {canManage && (
              <button
                onClick={onEdit}
                className={`h-9 px-3 rounded-full ${t.surface} border ${t.surfaceBorder} text-xs hover:border-green whitespace-nowrap flex-shrink-0`}
              >
                {a ? "Edit" : "Add"}
              </button>
            )}
          </div>
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

function FlightSuggestionsLoading({
  memberName, t, onClose,
}: {
  memberName: string;
  t: ReturnType<typeof themeClass>;
  onClose: () => void;
}) {
  // Matches the cover-generation loading pattern — bouncing travel
  // emojis (TravelLoadingDance) inside the same panel chrome that the
  // results panel will use, so swapping in the results when they
  // arrive is a visual replace, not a jump.
  return (
    <section className={`${t.surface} border ${t.surfaceBorder} rounded-2xl p-5 mb-10`}>
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <h3 className={`text-xs ${t.eyebrow}`}>
          Flight options for {memberName}
        </h3>
        <button onClick={onClose} className={`text-xs ${t.meta} hover:text-ink`}>Close</button>
      </div>
      <div className="flex flex-col items-center justify-center gap-3 py-8">
        <div className="scale-150">
          <TravelLoadingDance />
        </div>
        <p className={`text-sm font-semibold ${t.body}`}>
          Searching for flights…
        </p>
        <p className={`text-xs ${t.meta} text-center max-w-[28ch]`}>
          Asking AI for rough options — this usually takes 5–15 seconds.
        </p>
      </div>
    </section>
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
      {/* Fixed brand-controlled disclaimer. Gemini's grounded search
          returns plausible-looking flight data, not live inventory
          (no public Google Flights API exists). Always show the same
          honest one-liner regardless of what the model's `note`
          field says. */}
      <p className={`text-xs italic ${t.meta} mb-3`}>
        Rough flight ideas — select &ldquo;Book&rdquo; to verify on Google Flights
      </p>
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
  onSubmit, busy, t, defaultDepart, drivers,
}: {
  onSubmit: (dir: "outbound" | "return", dt: string, extras?: { driver_respondent_id?: string | null; seats_total?: number | null }) => void;
  busy: boolean;
  t: ReturnType<typeof themeClass>;
  defaultDepart: string;
  drivers: TravelMember[];
}) {
  const [direction, setDirection] = useState<"outbound" | "return">("outbound");
  const [departure, setDeparture] = useState(defaultDepart);
  const [driverId, setDriverId]   = useState<string>("");
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
      <select
        value={driverId}
        onChange={(e) => setDriverId(e.target.value)}
        className={`h-9 px-2 rounded-full bg-cream border ${t.surfaceBorder} text-xs max-w-[140px]`}
        title="Driver — optional"
      >
        <option value="">No driver yet</option>
        {drivers.map((d) => (
          <option key={d.respondent_id} value={d.respondent_id}>{d.name}</option>
        ))}
      </select>
      <button
        type="button"
        disabled={busy || !departure}
        onClick={() => {
          const driver = drivers.find((d) => d.respondent_id === driverId);
          onSubmit(direction, departure, {
            driver_respondent_id: driverId || null,
            seats_total: driver?.arrangement?.vehicle_capacity ?? null,
          });
        }}
        className="h-9 px-3 rounded-full bg-green text-cream font-bold text-xs hover:bg-green-2 disabled:opacity-50"
      >
        + Add
      </button>
    </div>
  );
}

function GroupingCard({
  grouping, members, t, canManage, callerRespondentId,
  onPatch, onPreAssign, onRemoveMember, onJoin, onDelete,
}: {
  grouping: GroupingView;
  members: TravelMember[];
  t: ReturnType<typeof themeClass>;
  canManage: boolean;
  callerRespondentId: string | null;
  onPatch: (patch: Partial<Pick<GroupingView, "seats_total" | "space_comfort" | "ride_notes" | "departure_datetime" | "driver_respondent_id">>) => Promise<boolean>;
  onPreAssign: (memId: string) => void;
  onRemoveMember: (memId: string) => void;
  onJoin: () => void;
  onDelete: () => void;
}) {
  const driver = grouping.driver_respondent_id
    ? members.find((m) => m.respondent_id === grouping.driver_respondent_id) ?? null
    : null;
  const memberRowById = new Map(grouping.members.map((gm) => [gm.respondent_id, gm]));
  const callerInRide = callerRespondentId ? memberRowById.has(callerRespondentId) : false;
  const callerIsDriver = !!callerRespondentId && grouping.driver_respondent_id === callerRespondentId;
  const canEditRide = canManage || callerIsDriver;
  const seatsTaken  = grouping.members.length;
  const seatsTotal  = grouping.seats_total;
  const seatsLeft   = seatsTotal != null ? Math.max(0, seatsTotal - seatsTaken) : null;
  const isFull      = seatsLeft === 0;

  const [adding, setAdding]   = useState("");
  const [editing, setEditing] = useState(false);

  const goingAndMaybe = members.filter(
    (m) => !memberRowById.has(m.respondent_id) && m.respondent_id !== grouping.driver_respondent_id,
  );

  return (
    <article className={`${t.surface} border ${t.surfaceBorder} rounded-2xl p-4`}>
      <div className="flex items-start justify-between flex-wrap gap-3 mb-3">
        <div className="min-w-0">
          <p className={`text-[10px] uppercase tracking-widest font-bold ${t.meta}`}>
            {grouping.direction === "outbound" ? "Outbound" : "Return"}
            {driver && <> · driver: <span className={t.body}>{driver.name}</span></>}
          </p>
          <p className={`font-bold ${t.body}`}>{formatDt(grouping.departure_datetime)}</p>
          {grouping.ride_notes && (
            <p className={`text-xs ${t.body} mt-1 whitespace-pre-line italic`}>
              &ldquo;{grouping.ride_notes}&rdquo;
            </p>
          )}
          {grouping.notes && (
            <p className={`text-xs ${t.meta} mt-1`}>{grouping.notes}</p>
          )}
        </div>

        <div className="flex flex-col items-end gap-2">
          {seatsTotal != null ? (
            <p className={`text-xs ${t.meta}`}>
              <span className={`font-bold ${t.body}`}>{seatsTaken}</span>
              {" / "}{seatsTotal} seats {isFull && <span className="text-orange font-semibold">· full</span>}
            </p>
          ) : (
            <p className={`text-xs ${t.meta}`}>{seatsTaken} on board</p>
          )}
          {grouping.space_comfort && (
            <span className={`text-[10px] uppercase tracking-widest font-bold ${
              grouping.space_comfort === "tight" ? "text-orange"
              : grouping.space_comfort === "comfortable" ? "text-green"
              : "text-green"
            }`}>
              {grouping.space_comfort === "tight" ? "🚐 tight fit" : grouping.space_comfort === "comfortable" ? "👌 comfortable" : "🛋 lots of room"}
            </span>
          )}
        </div>
      </div>

      {/* Edit-ride controls (driver or planner) */}
      {canEditRide && (
        <div className="flex flex-wrap gap-2 mb-3">
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            className={`h-8 px-3 rounded-full ${t.surface} border ${t.surfaceBorder} text-xs hover:border-green`}
          >
            {editing ? "Done editing" : "Edit ride →"}
          </button>
          {canManage && (
            <button onClick={onDelete} className={`text-xs ${t.meta} hover:text-orange self-center`}>
              Remove ride
            </button>
          )}
        </div>
      )}
      {editing && canEditRide && (
        <RideEditForm grouping={grouping} t={t} onPatch={onPatch} />
      )}

      {/* Member chips — pre-assigned shows 🔒 */}
      {grouping.members.length > 0 && (
        <ul className="flex flex-wrap gap-1.5 mb-3">
          {grouping.members.map((gm) => {
            const member = members.find((m) => m.respondent_id === gm.respondent_id);
            const name = member?.name ?? "(unknown)";
            const isSelf = callerRespondentId === gm.respondent_id;
            return (
              <li
                key={gm.respondent_id}
                className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-xs font-semibold border ${
                  gm.pre_assigned ? "bg-green-soft text-green border-green/40" : "bg-cream text-ink border-line"
                }`}
              >
                {gm.pre_assigned && <span aria-hidden title="Pre-assigned by driver">🔒</span>}
                <span>{name}</span>
                {(canEditRide || isSelf) && gm.respondent_id !== grouping.driver_respondent_id && (
                  <button
                    type="button"
                    onClick={() => onRemoveMember(gm.respondent_id)}
                    className={`text-xs ${t.meta} hover:text-orange ml-1`}
                    aria-label={`Remove ${name}`}
                  >
                    ×
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Bottom action row */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Passenger Join button */}
        {callerRespondentId && !callerInRide && !callerIsDriver && !isFull && (
          <button
            type="button"
            onClick={onJoin}
            className="h-9 px-4 rounded-full bg-green text-cream font-bold text-xs hover:bg-green-2"
          >
            Join this ride →
          </button>
        )}
        {/* Caller already in the ride — quick leave */}
        {callerRespondentId && callerInRide && !callerIsDriver && (
          <button
            type="button"
            onClick={() => onRemoveMember(callerRespondentId)}
            className={`h-9 px-4 rounded-full ${t.surface} border ${t.surfaceBorder} text-xs hover:border-orange hover:text-orange`}
          >
            Leave ride
          </button>
        )}
        {/* Driver / planner pre-assign dropdown */}
        {canEditRide && goingAndMaybe.length > 0 && !isFull && (
          <>
            <select
              value={adding}
              onChange={(e) => setAdding(e.target.value)}
              className={`h-9 px-2 rounded-full bg-cream border ${t.surfaceBorder} text-xs`}
            >
              <option value="">Pre-assign someone…</option>
              {goingAndMaybe.map((m) => (
                <option key={m.respondent_id} value={m.respondent_id}>{m.name}</option>
              ))}
            </select>
            <button
              type="button"
              disabled={!adding}
              onClick={() => { if (adding) { onPreAssign(adding); setAdding(""); } }}
              className="h-9 px-3 rounded-full bg-green text-cream font-bold text-xs hover:bg-green-2 disabled:opacity-50"
            >
              + Add
            </button>
          </>
        )}
        {isFull && callerRespondentId && !callerInRide && !callerIsDriver && (
          <p className={`text-xs ${t.meta}`}>This ride is full.</p>
        )}
      </div>
    </article>
  );
}

function RideEditForm({
  grouping, t, onPatch,
}: {
  grouping: GroupingView;
  t: ReturnType<typeof themeClass>;
  onPatch: (p: Partial<Pick<GroupingView, "seats_total" | "space_comfort" | "ride_notes" | "departure_datetime">>) => Promise<boolean>;
}) {
  const [seats,   setSeats]   = useState<number | "">(grouping.seats_total ?? "");
  const [comfort, setComfort] = useState<SpaceComfort | "">(grouping.space_comfort ?? "");
  const [notes,   setNotes]   = useState(grouping.ride_notes ?? "");
  const [status,  setStatus]  = useState<"idle" | "saving" | "saved" | "error">("idle");

  // After router.refresh() the grouping prop changes; sync the
  // form's drafts so a re-edit starts from the latest persisted
  // values (no stale-input drift across saves).
  useEffect(() => {
    setSeats(grouping.seats_total ?? "");
    setComfort(grouping.space_comfort ?? "");
    setNotes(grouping.ride_notes ?? "");
  }, [grouping.seats_total, grouping.space_comfort, grouping.ride_notes]);

  async function save() {
    setStatus("saving");
    const ok = await onPatch({
      seats_total: seats === "" ? null : seats,
      space_comfort: (comfort || null) as SpaceComfort | null,
      ride_notes: notes.trim() === "" ? null : notes.trim(),
    });
    if (!ok) { setStatus("error"); return; }
    setStatus("saved");
    setTimeout(() => setStatus((s) => (s === "saved" ? "idle" : s)), 1800);
  }

  const dirty =
    (seats === "" ? null : seats) !== (grouping.seats_total ?? null)
    || ((comfort || null) as string | null) !== (grouping.space_comfort ?? null)
    || (notes.trim() === "" ? null : notes.trim()) !== (grouping.ride_notes ?? null);

  return (
    <div className={`bg-cream border border-line rounded-xl p-3 grid gap-2 mb-3`}>
      <div className="flex flex-wrap gap-2">
        <label className="flex items-center gap-1.5">
          <span className={`text-[10px] uppercase tracking-widest font-bold ${t.meta}`}>Seats</span>
          <input
            type="number"
            min={1}
            max={20}
            value={seats}
            onChange={(e) => { setSeats(e.target.value === "" ? "" : Number(e.target.value)); setStatus("idle"); }}
            className={`h-8 w-16 px-2 rounded-md border ${t.surfaceBorder} text-sm`}
          />
        </label>
        <label className="flex items-center gap-1.5">
          <span className={`text-[10px] uppercase tracking-widest font-bold ${t.meta}`}>Comfort</span>
          <select
            value={comfort}
            onChange={(e) => { setComfort(e.target.value as SpaceComfort | ""); setStatus("idle"); }}
            className={`h-8 px-2 rounded-md border ${t.surfaceBorder} text-sm`}
          >
            <option value="">—</option>
            <option value="tight">Tight fit</option>
            <option value="comfortable">Comfortable</option>
            <option value="spacious">Lots of room</option>
          </select>
        </label>
      </div>
      <label className="grid gap-1">
        <span className={`text-[10px] uppercase tracking-widest font-bold ${t.meta}`}>Notes to passengers</span>
        <textarea
          rows={2}
          value={notes}
          maxLength={500}
          onChange={(e) => { setNotes(e.target.value); setStatus("idle"); }}
          placeholder="Leaving at 6am sharp · gas stop in Modesto · happy to swing by Oakland for pickup"
          className={`rounded-md border ${t.surfaceBorder} bg-card px-3 py-2 text-sm`}
        />
      </label>
      <div className="flex items-center justify-end gap-2">
        {status === "saved" && (
          <span className="text-xs text-green font-semibold">Saved ✓</span>
        )}
        {status === "error" && (
          <span className="text-xs text-orange font-semibold">Couldn&rsquo;t save — try again</span>
        )}
        <button
          type="button"
          onClick={save}
          disabled={status === "saving" || !dirty}
          className={
            "h-8 px-3 rounded-full text-xs font-bold transition-colors " +
            (status === "saved"
              ? "bg-green-soft text-green border border-green/40"
              : "bg-green text-cream hover:bg-green-2 disabled:opacity-50 disabled:cursor-not-allowed")
          }
        >
          {status === "saving" ? "Saving…" : status === "saved" ? "Saved ✓" : "Save"}
        </button>
      </div>
    </div>
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
