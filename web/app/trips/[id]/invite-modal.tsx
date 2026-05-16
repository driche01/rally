"use client";

/**
 * InviteModal — composes a batch of invitations + an optional
 * custom message, calls /api/trips/[id]/invitations, then closes.
 *
 * Minimal Phase A version: manual add (name + phone), past trip-
 * mates list (calls /api/mutuals; empty until Step 10 populates).
 * Email is captured per recipient but Phase A only sends via SMS —
 * email exists on the respondents row for future use.
 */

import { useEffect, useRef, useState } from "react";
import type { Respondent, Mutual } from "@shared/types";
import VariableLegend from "@/lib/sms/variable-legend";

interface Recipient {
  name: string;
  phone: string;
  email?: string;
}

export default function InviteModal({
  tripId, tripName, shareLink, onClose, onSent,
}: {
  tripId: string;
  tripName: string;
  shareLink: string;
  onClose: () => void;
  onSent: (newRespondents: Respondent[], summary: import("@shared/types").ActivityFeedEntry | null) => void;
}) {
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [customMessage, setCustomMessage] = useState("");
  const noteRef = useRef<HTMLTextAreaElement | null>(null);

  function insertNoteToken(token: string) {
    const el = noteRef.current;
    if (!el) { setCustomMessage((m) => m + token); return; }
    const start = el.selectionStart ?? customMessage.length;
    const end   = el.selectionEnd ?? customMessage.length;
    setCustomMessage(customMessage.slice(0, start) + token + customMessage.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = start + token.length;
    });
  }
  const [mutuals, setMutuals] = useState<Mutual[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [summary, setSummary] = useState<{ sent: number; failed: number; details: string[] } | null>(null);

  useEffect(() => {
    // Past trip-mates — empty until Step 10's job runs.
    fetch("/api/mutuals")
      .then((r) => r.json())
      .then((b) => { if (b.ok) setMutuals(b.data ?? []); })
      .catch(() => {});
  }, []);

  function addRecipient() {
    if (!name.trim() || !phone.trim()) {
      setErr("Name and phone are both required.");
      return;
    }
    setRecipients((prev) => [...prev, { name: name.trim(), phone: phone.trim(), email: email.trim() || undefined }]);
    setName("");
    setPhone("");
    setEmail("");
    setErr(null);
  }

  function removeRecipient(i: number) {
    setRecipients((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function send() {
    if (recipients.length === 0) {
      setErr("Add at least one recipient first.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/trips/${tripId}/invitations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipients,
          custom_message: customMessage.trim() || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        setErr(body?.error?.code || `Server error (${res.status})`);
        return;
      }
      const d = body.data as {
        sent: number; failed: number; recipients: { phone: string; name: string; status: string; detail?: string }[];
      };
      setSummary({
        sent: d.sent,
        failed: d.failed,
        details: d.recipients.map(
          (r) => `${r.name || r.phone}: ${r.status}${r.detail ? ` (${r.detail})` : ""}`,
        ),
      });
      // We don't have the new respondent rows back from this endpoint;
      // refetch them so the parent dashboard can update without a hard
      // page reload.
      await refreshAndNotify(tripId, onSent);
    } catch {
      setErr("Couldn't reach Rally. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const charsLeft = 480 - customMessage.length;

  return (
    <div
      className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="bg-cream w-full sm:max-w-lg sm:rounded-[28px] rounded-t-[28px] max-h-[92dvh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-5 sm:py-6 border-b border-line flex items-start justify-between">
          <div>
            <p className="text-xs font-bold tracking-widest uppercase text-green mb-1">
              Send invitations
            </p>
            <h2 className="font-display text-2xl text-ink">{tripName}</h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="h-10 w-10 rounded-full hover:bg-line/40 text-ink text-2xl leading-none -mr-2"
          >
            ×
          </button>
        </div>

        <div className="px-6 py-5 grid gap-6">
          {summary ? (
            <SummaryView
              summary={summary}
              onAddMore={() => { setSummary(null); setRecipients([]); }}
              onClose={onClose}
            />
          ) : (
            <>
              {/* ─── Add recipient ─────────────────── */}
              <section>
                <p className="text-xs uppercase tracking-widest text-muted font-semibold mb-3">
                  Add a friend
                </p>
                <div className="grid gap-2">
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Name"
                    maxLength={30}
                    className="h-12 rounded-xl border border-line bg-card px-4 text-ink placeholder:text-muted focus:border-green focus:outline-none"
                  />
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="Phone (E.164 — +1...)"
                    className="h-12 rounded-xl border border-line bg-card px-4 text-ink placeholder:text-muted focus:border-green focus:outline-none"
                  />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Email (optional)"
                    className="h-12 rounded-xl border border-line bg-card px-4 text-ink placeholder:text-muted focus:border-green focus:outline-none"
                  />
                  <button
                    onClick={addRecipient}
                    className="h-11 rounded-full bg-card text-ink border border-line hover:border-green hover:bg-green-soft/40 self-start px-5 text-sm font-semibold"
                  >
                    + Add to list
                  </button>
                </div>
              </section>

              {/* ─── Past trip-mates ───────────────── */}
              <PastTripmatesSection mutuals={mutuals} />


              {/* ─── Recipients list ───────────────── */}
              {recipients.length > 0 && (
                <section>
                  <p className="text-xs uppercase tracking-widest text-muted font-semibold mb-2">
                    Sending to · {recipients.length}
                  </p>
                  <ul className="grid gap-1.5">
                    {recipients.map((r, i) => (
                      <li
                        key={`${r.phone}-${i}`}
                        className="flex items-center gap-2 bg-card border border-line rounded-full pl-3 pr-1 py-1"
                      >
                        <span className="text-sm text-ink font-semibold flex-1">
                          {r.name}
                          <span className="text-muted font-normal ml-2">{r.phone}</span>
                        </span>
                        <button
                          onClick={() => removeRecipient(i)}
                          aria-label={`Remove ${r.name}`}
                          className="h-7 w-7 rounded-full hover:bg-line/40 text-muted hover:text-ink"
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {/* ─── Custom message ────────────────── */}
              <section>
                <label className="grid gap-2">
                  <span className="text-xs uppercase tracking-widest text-muted font-semibold">
                    Add a personal note (optional)
                  </span>
                  <textarea
                    ref={noteRef}
                    rows={3}
                    maxLength={480}
                    value={customMessage}
                    onChange={(e) => setCustomMessage(e.target.value)}
                    placeholder={`Default: “${placeholderMessage(tripName)}”`}
                    className="rounded-xl border border-line bg-card px-4 py-3 text-ink placeholder:text-muted focus:border-green focus:outline-none"
                  />
                </label>
                <p className="text-xs text-muted mt-1 text-right">
                  {charsLeft} left
                </p>
                <VariableLegend onInsert={insertNoteToken} className="mt-2" />
              </section>

              {err && <p className="text-orange text-sm">{err}</p>}

              {/* ─── Footer ──────────────────────── */}
              <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
                <button
                  onClick={onClose}
                  className="h-12 px-5 rounded-full bg-card text-muted border border-line hover:border-green hover:text-ink"
                >
                  Cancel
                </button>
                <button
                  onClick={send}
                  disabled={busy || recipients.length === 0}
                  className="h-12 px-6 rounded-full bg-green text-cream font-bold hover:bg-green-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {busy
                    ? "Sending…"
                    : `Send ${recipients.length} invitation${recipients.length === 1 ? "" : "s"} →`}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function PastTripmatesSection({ mutuals }: { mutuals: Mutual[] }) {
  type SortKey = "most_shared" | "most_recent" | "alpha";
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortKey>("most_shared");

  const filtered = mutuals
    .filter((m) => !q || m.mutual_user_id.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => {
      if (sort === "most_shared") return b.shared_trip_count - a.shared_trip_count;
      if (sort === "most_recent") {
        const ta = a.last_traveled_together_at ? new Date(a.last_traveled_together_at).getTime() : 0;
        const tb = b.last_traveled_together_at ? new Date(b.last_traveled_together_at).getTime() : 0;
        return tb - ta;
      }
      return a.mutual_user_id.localeCompare(b.mutual_user_id);
    });

  return (
    <section>
      <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
        <p className="text-xs uppercase tracking-widest text-muted font-semibold">
          Past trip-mates
        </p>
        {mutuals.length > 0 && (
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="h-7 px-2 rounded-full border border-line bg-card text-xs text-ink"
            aria-label="Sort past trip-mates"
          >
            <option value="most_shared">Most shared</option>
            <option value="most_recent">Most recent</option>
            <option value="alpha">A→Z</option>
          </select>
        )}
      </div>
      {mutuals.length === 0 ? (
        <p className="text-xs text-muted">
          No past trip-mates yet — this fills in as you share trips with people.
        </p>
      ) : (
        <>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search past trip-mates…"
            className="w-full h-9 rounded-full border border-line bg-card px-3 text-xs text-ink placeholder:text-muted focus:border-green focus:outline-none mb-2"
          />
          <ul className="grid gap-1 max-h-32 overflow-y-auto">
            {filtered.slice(0, 12).map((m) => (
              <li key={m.mutual_user_id} className="text-sm text-ink">
                · {m.mutual_user_id} (shared {m.shared_trip_count})
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function SummaryView({
  summary,
  onAddMore,
  onClose,
}: {
  summary: { sent: number; failed: number; details: string[] };
  onAddMore: () => void;
  onClose: () => void;
}) {
  return (
    <div className="grid gap-4">
      <p className="text-xs uppercase tracking-widest text-green font-semibold">
        Sent
      </p>
      <h3 className="font-display text-3xl text-ink leading-tight">
        {summary.sent} invitation{summary.sent === 1 ? "" : "s"} on the way.
      </h3>
      {summary.failed > 0 && (
        <p className="text-orange text-sm">{summary.failed} failed to send.</p>
      )}
      <ul className="bg-card border border-line rounded-2xl divide-y divide-line max-h-48 overflow-y-auto">
        {summary.details.map((d, i) => (
          <li key={i} className="px-4 py-2 text-sm text-ink">{d}</li>
        ))}
      </ul>
      <div className="flex gap-2 pt-2 flex-col-reverse sm:flex-row sm:justify-end">
        <button
          onClick={onAddMore}
          className="h-11 px-5 rounded-full bg-card text-ink border border-line hover:border-green text-sm"
        >
          Send more
        </button>
        <button
          onClick={onClose}
          className="h-11 px-5 rounded-full bg-green text-cream font-bold hover:bg-green-2 text-sm"
        >
          Done
        </button>
      </div>
    </div>
  );
}

function placeholderMessage(tripName: string) {
  // Mirrors composeBody() in /api/trips/[id]/invitations — keeps
  // the modal preview honest about what actually goes out.
  return `[Planner] is putting together ${tripName}. Tap to see the deets + RSVP — bookings will get locked in by [book-by date] so a quick yes/no helps solidify plans`;
}

async function refreshAndNotify(
  tripId: string,
  notify: (newRespondents: Respondent[], summary: import("@shared/types").ActivityFeedEntry | null) => void,
) {
  try {
    // We don't have a dedicated "list respondents for this trip"
    // endpoint yet; for the dashboard's purposes, just hit /api/trips/[id]
    // (which the dashboard already has). For now, signal a parent
    // reload by passing an empty array — parent will refetch.
    notify([], null);
    // Force a fresh server render so the SSR roster pulls the new rows.
    // Next.js router refresh from a client component requires `useRouter`;
    // simpler: nudge a global location reload via the parent.
    if (typeof window !== "undefined") {
      // Soft-refresh — picked up by Next.js client router on next event loop.
      window.location.reload();
    }
  } catch {
    // ignore
  }
}
