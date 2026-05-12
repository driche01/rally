"use client";

/**
 * Activity section on the public invitation page.
 * Adds: comment composer + realtime updates via Supabase realtime.
 * Build guide §6 Step 9.
 *
 * Subscription scope: activity_feed_entries WHERE trip_id = current.
 * The anon SELECT policy on this table lets the browser client
 * subscribe with the publishable key alone — no auth needed.
 */

import { useEffect, useRef, useState } from "react";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import type { ActivityFeedEntry } from "@shared/types";

const COMMENTER_KEY = "rally.commenter";

interface CommenterMemo {
  name: string;
  phone: string;
}

export default function ActivitySection({
  tripId,
  shareToken,
  initial,
}: {
  tripId: string;
  shareToken: string;
  initial: ActivityFeedEntry[];
}) {
  const [entries, setEntries] = useState<ActivityFeedEntry[]>(initial);
  const [text, setText]       = useState("");
  const [name, setName]       = useState("");
  const [phone, setPhone]     = useState("");
  const [showIdentify, setShowIdentify] = useState(false);
  const [busy, setBusy]       = useState(false);
  const [err, setErr]         = useState<string | null>(null);

  const seen = useRef(new Set(initial.map((e) => e.id)));

  // ─── Restore commenter memo from sessionStorage ───────────────
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(COMMENTER_KEY);
      if (raw) {
        const memo = JSON.parse(raw) as CommenterMemo;
        if (memo.name) setName(memo.name);
        if (memo.phone) setPhone(memo.phone);
      }
    } catch {}
  }, []);

  // ─── Realtime subscription ───────────────────────────────────
  useEffect(() => {
    const supabase = createBrowserClient();
    const channel = supabase
      .channel(`activity:${tripId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "activity_feed_entries",
          filter: `trip_id=eq.${tripId}`,
        },
        (payload: { new: ActivityFeedEntry }) => {
          const entry = payload.new;
          if (!entry || seen.current.has(entry.id)) return;
          seen.current.add(entry.id);
          setEntries((prev) => [entry, ...prev].slice(0, 50));
        },
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [tripId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!text.trim()) return;
    if (!name.trim()) {
      setShowIdentify(true);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/invite/${shareToken}/comment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), phone: phone.trim() || undefined, text: text.trim() }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        setErr(body?.error?.code ?? `Couldn't post (${res.status})`);
        return;
      }
      // Realtime should add the entry too — guard against double-add via `seen`.
      const fresh = body.data as ActivityFeedEntry;
      if (!seen.current.has(fresh.id)) {
        seen.current.add(fresh.id);
        setEntries((prev) => [fresh, ...prev].slice(0, 50));
      }
      setText("");
      // Remember the commenter for the rest of the session.
      try {
        sessionStorage.setItem(
          COMMENTER_KEY,
          JSON.stringify({ name: name.trim(), phone: phone.trim() }),
        );
      } catch {}
      setShowIdentify(false);
    } catch {
      setErr("Couldn't reach Rally. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-12">
      <h2 className="font-display text-2xl text-ink mb-4">Activity</h2>

      {/* ─── Composer ────────────────────────────────────────── */}
      <form
        onSubmit={submit}
        className="bg-card border border-line rounded-2xl p-4 mb-5 grid gap-3"
      >
        <textarea
          rows={2}
          maxLength={500}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Drop a comment for the group…"
          className="rounded-xl border border-line bg-cream-2/40 px-3 py-2 text-ink placeholder:text-muted text-sm focus:border-green focus:outline-none resize-none"
        />
        {(showIdentify || (text.length > 0 && !name)) && (
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              type="text"
              maxLength={30}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              className="h-11 rounded-xl border border-line bg-cream-2/40 px-3 text-sm text-ink placeholder:text-muted focus:border-green focus:outline-none"
            />
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Phone (optional)"
              className="h-11 rounded-xl border border-line bg-cream-2/40 px-3 text-sm text-ink placeholder:text-muted focus:border-green focus:outline-none"
            />
          </div>
        )}
        {err && <p className="text-orange text-xs">{err}</p>}
        <div className="flex items-center justify-between text-xs text-muted">
          <span>{text.length}/500</span>
          <button
            type="submit"
            disabled={busy || !text.trim()}
            className="h-10 px-5 rounded-full bg-green text-cream font-bold hover:bg-green-2 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
          >
            {busy ? "Posting…" : "Post"}
          </button>
        </div>
      </form>

      {/* ─── Feed ────────────────────────────────────────────── */}
      {entries.length === 0 ? (
        <p className="text-muted text-sm">
          Be the first to say something.
        </p>
      ) : (
        <ul className="grid gap-3">
          {entries.map((e) => (
            <li
              key={e.id}
              className="bg-card border border-line rounded-2xl p-4 text-sm"
            >
              <p className="text-xs uppercase tracking-widest text-muted font-semibold mb-1">
                {formatHeader(e)} · {formatRelative(e.created_at)}
              </p>
              <p className="text-ink whitespace-pre-line">
                {formatBody(e)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function formatHeader(e: ActivityFeedEntry): string {
  const c = e.content as Record<string, unknown>;
  if (e.entry_type === "comment" && typeof c.name === "string") {
    return c.name;
  }
  switch (e.entry_type) {
    case "rsvp_update":  return "RSVP";
    case "comment":      return "Comment";
    case "gif":          return "Gif";
    case "photo":        return "Photo";
    case "planner_post": return "From the host";
    case "system":       return "Update";
  }
  return "Update";
}

function formatBody(e: ActivityFeedEntry): string {
  const c = e.content as Record<string, unknown>;
  if (typeof c.text === "string") return c.text;
  if (typeof c.message === "string") return c.message;
  if (typeof c.name === "string" && typeof c.status === "string") {
    return `${c.name} → ${c.status}`;
  }
  return "(see details)";
}

function formatRelative(iso: string): string {
  const ago = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ago / 1000);
  if (s < 60)    return "just now";
  if (s < 3600)  return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
