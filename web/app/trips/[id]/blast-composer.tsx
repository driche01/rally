"use client";

/**
 * BlastComposer — host/cohost composes a 1-to-many SMS blast.
 * Phase C Step 4. POSTs to /api/trips/[id]/blasts.
 *
 * Segment selector + live recipient count + char counter + preview +
 * rate-limit display + confirm step. Voice principles from scope doc:
 * playful, personal, link-driven.
 */

import { useEffect, useMemo, useState } from "react";
import type { Respondent, RecipientSegment, PlannerBlast } from "@shared/types";

interface SendResult {
  blast_id: string;
  sent: number;
  failed: number;
  suppressed_opted_out: number;
  suppressed_24h: number;
  recipients: { phone: string; name: string; status: string; detail?: string }[];
  limits_remaining: { weekly: number; lifetime: number };
}

interface Limits {
  weekly_used: number;
  weekly_limit: number;
  lifetime_used: number;
  lifetime_limit: number;
  weekly_remaining: number;
  lifetime_remaining: number;
  can_send: boolean;
}

const SEGMENT_LABELS: Record<RecipientSegment, string> = {
  going:   "Going",
  maybe:   "Maybe",
  invited: "Invited",
  all:     "Everyone",
};

const MAX_BODY = 1600;
const RECOMMENDED = 480;

export default function BlastComposer({
  tripId,
  tripName,
  respondents,
  onClose,
}: {
  tripId: string;
  tripName: string;
  respondents: Respondent[];
  onClose: () => void;
}) {
  const [segment, setSegment] = useState<RecipientSegment>("going");
  const [body, setBody] = useState("");
  const [includePlanner, setIncludePlanner] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [limits, setLimits] = useState<Limits | null>(null);

  // Segment counts from the roster the parent already loaded.
  const counts = useMemo(() => {
    const c = { going: 0, maybe: 0, invited: 0, all: 0 };
    for (const r of respondents) {
      if (!r.phone) continue;                       // unreachable
      if (!includePlanner && r.is_planner) continue; // exclude planner if box off
      const s = (r.rsvp_status ?? "invited") as keyof typeof c;
      if (s in c) c[s]++;
      c.all++;
    }
    return c;
  }, [respondents, includePlanner]);

  const recipientCount = counts[segment];

  useEffect(() => {
    let cancel = false;
    fetch(`/api/trips/${tripId}/blasts`)
      .then((r) => r.json())
      .then((b) => { if (!cancel && b.ok) setLimits(b.data.limits as Limits); })
      .catch(() => {});
    return () => { cancel = true; };
  }, [tripId]);

  const charsLeft = MAX_BODY - body.length;
  const overRecommended = body.length > RECOMMENDED;

  async function send() {
    setSending(true);
    setErr(null);
    try {
      const res = await fetch(`/api/trips/${tripId}/blasts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipient_segment: segment,
          message_body: body,
          include_planner: includePlanner,
        }),
      });
      const b = await res.json();
      if (!res.ok || !b.ok) {
        setErr(b?.error?.code ?? `Server error (${res.status})`);
        return;
      }
      setResult(b.data as SendResult);
    } catch {
      setErr("Couldn't reach Rally. Try again.");
    } finally {
      setSending(false);
    }
  }

  const previewBody = body
    .replace(/\[Name\]/g, "[Friend]")
    .replace(/\[Trip\]/g, tripName);

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
              Send blast
            </p>
            <h2 className="font-display text-2xl text-ink">{tripName}</h2>
            {limits && (
              <p className="text-xs text-muted mt-1">
                {limits.weekly_remaining}/3 weekly · {limits.lifetime_remaining}/10 lifetime remaining
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="h-10 w-10 rounded-full hover:bg-line/40 text-ink text-2xl leading-none -mr-2"
          >
            ×
          </button>
        </div>

        <div className="px-6 py-5 grid gap-5">
          {result ? (
            <SendSummary result={result} onClose={onClose} />
          ) : confirming ? (
            <ConfirmPanel
              count={recipientCount}
              segment={segment}
              sending={sending}
              onConfirm={send}
              onCancel={() => setConfirming(false)}
            />
          ) : (
            <>
              {/* ─── Segment ─────────────────────── */}
              <section>
                <p className="text-xs uppercase tracking-widest text-muted font-semibold mb-2">
                  Send to
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {(Object.keys(SEGMENT_LABELS) as RecipientSegment[]).map((s) => (
                    <button
                      key={s}
                      onClick={() => setSegment(s)}
                      className={
                        segment === s
                          ? "h-11 px-3 rounded-full bg-green-soft text-green border border-green font-semibold text-sm"
                          : "h-11 px-3 rounded-full bg-card text-ink border border-line text-sm hover:border-green-soft"
                      }
                    >
                      {SEGMENT_LABELS[s]}
                      <span className="block text-xs text-muted font-normal">{counts[s]}</span>
                    </button>
                  ))}
                </div>
              </section>

              {/* ─── Include planner toggle ──────── */}
              <label className="flex items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={includePlanner}
                  onChange={(e) => setIncludePlanner(e.target.checked)}
                  className="h-4 w-4 accent-green"
                />
                Also send to me
              </label>

              {/* ─── Body ────────────────────────── */}
              <section>
                <label className="grid gap-2">
                  <span className="text-xs uppercase tracking-widest text-muted font-semibold">
                    Message
                  </span>
                  <textarea
                    rows={5}
                    maxLength={MAX_BODY}
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder={`Hey [Name] — quick heads-up on ${tripName}...`}
                    className="rounded-xl border border-line bg-card px-4 py-3 text-ink placeholder:text-muted focus:border-green focus:outline-none text-sm"
                  />
                </label>
                <p className={`text-xs mt-1 text-right ${overRecommended ? "text-orange" : "text-muted"}`}>
                  {charsLeft} chars left {overRecommended && "· will span 2+ SMS segments"}
                </p>
                <p className="text-xs text-muted mt-1">
                  Use <code className="bg-line/40 px-1 rounded">[Name]</code> to insert each recipient&rsquo;s first name.
                </p>
              </section>

              {/* ─── Preview ─────────────────────── */}
              {body.trim() && (
                <section>
                  <p className="text-xs uppercase tracking-widest text-muted font-semibold mb-1">
                    Preview (one recipient sees:)
                  </p>
                  <div className="bg-card border border-line rounded-2xl p-3 text-sm text-ink whitespace-pre-line">
                    {previewBody}
                  </div>
                </section>
              )}

              {/* ─── Recipients without a profile note ─ */}
              {(segment === "invited" || segment === "all") && (
                <p className="text-xs text-muted">
                  Recipients without a profile will receive this in your local time window.
                </p>
              )}

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
                  onClick={() => setConfirming(true)}
                  disabled={!body.trim() || recipientCount === 0 || !limits?.can_send}
                  className="h-12 px-6 rounded-full bg-green text-cream font-bold hover:bg-green-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {recipientCount === 0
                    ? "No recipients"
                    : !limits?.can_send
                      ? "Rate limit hit"
                      : `Send to ${recipientCount} →`}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ConfirmPanel({
  count, segment, sending, onConfirm, onCancel,
}: {
  count: number;
  segment: RecipientSegment;
  sending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="grid gap-4">
      <p className="text-xs uppercase tracking-widest text-orange font-semibold">
        Confirm send
      </p>
      <h3 className="font-display text-2xl text-ink leading-tight">
        This will send {count} SMS message{count === 1 ? "" : "s"} and post to the activity feed.
      </h3>
      <p className="text-sm text-muted">
        Segment: <strong className="text-ink">{SEGMENT_LABELS[segment]}</strong>. Recipients who opted out or hit the per-recipient 24-hour limit will be suppressed.
      </p>
      <div className="flex gap-2 pt-2 flex-col-reverse sm:flex-row sm:justify-end">
        <button
          onClick={onCancel}
          disabled={sending}
          className="h-11 px-5 rounded-full bg-card text-ink border border-line hover:border-green disabled:opacity-50 text-sm"
        >
          Back
        </button>
        <button
          onClick={onConfirm}
          disabled={sending}
          className="h-11 px-5 rounded-full bg-green text-cream font-bold hover:bg-green-2 disabled:opacity-50 text-sm"
        >
          {sending ? "Sending…" : "Yes, send"}
        </button>
      </div>
    </div>
  );
}

function SendSummary({ result, onClose }: { result: SendResult; onClose: () => void }) {
  return (
    <div className="grid gap-4">
      <p className="text-xs uppercase tracking-widest text-green font-semibold">
        Sent
      </p>
      <h3 className="font-display text-3xl text-ink leading-tight">
        {result.sent} message{result.sent === 1 ? "" : "s"} on the way.
      </h3>
      <ul className="grid gap-1 text-sm text-muted">
        {result.failed > 0 && <li className="text-orange">{result.failed} failed.</li>}
        {result.suppressed_opted_out > 0 && (
          <li>{result.suppressed_opted_out} suppressed (opted out)</li>
        )}
        {result.suppressed_24h > 0 && (
          <li>{result.suppressed_24h} suppressed (over 2/24h limit)</li>
        )}
        <li className="pt-2 text-ink">
          {result.limits_remaining.weekly}/3 weekly blasts left · {result.limits_remaining.lifetime}/10 lifetime
        </li>
      </ul>
      <div className="flex justify-end pt-2">
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
