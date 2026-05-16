"use client";

/**
 * Activity section on the public invitation page (v2).
 *
 * Capabilities added in alpha-prep (backlog #11/#12/#13):
 *   - Soft-auth identity: respondents with the rally_session_token
 *     cookie post comments without re-entering name/phone (their
 *     identity threads through via /api/trips/[id]/activity).
 *   - Emoji reactions on every entry. Toggle via the picker; the
 *     server inserts/deletes the row in activity_reactions.
 *   - Threaded replies. Each top-level entry exposes a Reply control
 *     that opens an inline composer keyed off parent_id.
 *   - GIF picker (Tenor proxy) + photo upload directly from the
 *     composer.
 *
 * Truly anonymous visitors (no cookie, no auth) still get the
 * legacy /api/invite/[token]/comment path which asks for name/phone
 * inline.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import type { ActivityFeedEntry, ActivityReaction } from "@shared/types";

const ANON_COMMENTER_KEY = "rally.commenter";
const REACTION_PALETTE = ["👍", "❤️", "😂", "🎉", "🔥", "🙏"];

interface CommenterMemo { name: string; phone: string }

export default function ActivitySection({
  tripId,
  shareToken,
  initial,
}: {
  tripId: string;
  shareToken: string;
  initial: ActivityFeedEntry[];
}) {
  const [entries, setEntries]       = useState<ActivityFeedEntry[]>(initial);
  const [reactions, setReactions]   = useState<ActivityReaction[]>([]);
  const [softAuthed, setSoftAuthed] = useState(false);
  // Anon-only fallback fields — never read when softAuthed.
  const [anonName, setAnonName]   = useState("");
  const [anonPhone, setAnonPhone] = useState("");
  const seen = useRef(new Set(initial.map((e) => e.id)));

  // ─── Identity detection ──────────────────────────────────────
  // We don't have direct access to httpOnly cookies; instead, probe
  // a lightweight endpoint that returns 200 if there's a usable
  // session-cookie OR a Supabase auth session.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/account/whoami", { cache: "no-store" });
        if (cancelled) return;
        setSoftAuthed(r.ok);
      } catch { /* anon fallback */ }
    })();
    // Restore the anon memo so a returning visitor doesn't re-type.
    try {
      const raw = sessionStorage.getItem(ANON_COMMENTER_KEY);
      if (raw) {
        const memo = JSON.parse(raw) as CommenterMemo;
        if (memo.name) setAnonName(memo.name);
        if (memo.phone) setAnonPhone(memo.phone);
      }
    } catch { /* ignore */ }
    return () => { cancelled = true; };
  }, []);

  // ─── Initial reaction fetch + realtime ───────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await fetch(`/api/trips/${tripId}/activity/reactions`, { cache: "no-store" });
      if (!r.ok || cancelled) return;
      const body = await r.json();
      if (body?.ok) setReactions((body.data ?? []) as ActivityReaction[]);
    })();
    return () => { cancelled = true; };
  }, [tripId]);

  useEffect(() => {
    const supabase = createBrowserClient();
    const channel = supabase
      .channel(`activity:${tripId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "activity_feed_entries", filter: `trip_id=eq.${tripId}` },
        (payload: { new: ActivityFeedEntry }) => {
          const entry = payload.new;
          if (!entry || seen.current.has(entry.id)) return;
          seen.current.add(entry.id);
          setEntries((prev) => [entry, ...prev]);
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "activity_reactions" },
        () => {
          // Reaction churn on any trip — refetch this one's set.
          fetch(`/api/trips/${tripId}/activity/reactions`, { cache: "no-store" })
            .then((r) => r.json())
            .then((b) => { if (b?.ok) setReactions(b.data ?? []); })
            .catch(() => {});
        },
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [tripId]);

  // ─── Group entries into threads ──────────────────────────────
  const { roots, repliesByParent } = useMemo(() => {
    const sorted = [...entries].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
    const roots = sorted.filter((e) => !e.parent_id).reverse();          // newest top-level first
    const repliesByParent = new Map<string, ActivityFeedEntry[]>();
    for (const e of sorted) {
      if (!e.parent_id) continue;
      const list = repliesByParent.get(e.parent_id) ?? [];
      list.push(e);
      repliesByParent.set(e.parent_id, list);
    }
    return { roots, repliesByParent };
  }, [entries]);

  // ─── Post helper used by composer + reply ────────────────────
  const post = useCallback(async (
    payload: { entry_type: string; content: Record<string, unknown>; parent_id?: string | null },
  ): Promise<ActivityFeedEntry | null> => {
    if (softAuthed) {
      const res = await fetch(`/api/trips/${tripId}/activity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      return body?.ok ? (body.data as ActivityFeedEntry) : null;
    }
    // Anon fallback — comment only, no threading or media.
    if (payload.entry_type !== "comment") return null;
    if (!anonName.trim()) return null;
    const text = (payload.content.text as string | undefined) ?? "";
    const res = await fetch(`/api/invite/${shareToken}/comment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: anonName.trim(),
        phone: anonPhone.trim() || undefined,
        text,
      }),
    });
    const body = await res.json();
    if (body?.ok) {
      try {
        sessionStorage.setItem(
          ANON_COMMENTER_KEY,
          JSON.stringify({ name: anonName.trim(), phone: anonPhone.trim() }),
        );
      } catch { /* ignore */ }
    }
    return body?.ok ? (body.data as ActivityFeedEntry) : null;
  }, [softAuthed, anonName, anonPhone, shareToken, tripId]);

  function addEntryLocal(entry: ActivityFeedEntry) {
    if (seen.current.has(entry.id)) return;
    seen.current.add(entry.id);
    setEntries((prev) => [entry, ...prev]);
  }

  async function toggleReaction(entryId: string, emoji: string) {
    if (!softAuthed) return; // anon can't react
    const supabase = createBrowserClient();
    const { data: auth } = await supabase.auth.getUser();
    // We don't know the user's users.id client-side easily; the
    // server resolves it. Optimistic update by treating presence in
    // local list as the toggle state.
    const hadLocal = reactions.some(
      (r) => r.entry_id === entryId && r.emoji === emoji && (auth?.user?.id ? true : true),
    );
    // Send the toggle to the server first to avoid the (very rare)
    // double-fire issue. The realtime listener will re-sync.
    await fetch(`/api/trips/${tripId}/activity/${entryId}/reactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ emoji }),
    });
    // If the realtime fan-out is slow, refetch.
    setTimeout(() => {
      fetch(`/api/trips/${tripId}/activity/reactions`, { cache: "no-store" })
        .then((r) => r.json())
        .then((b) => { if (b?.ok) setReactions(b.data ?? []); })
        .catch(() => {});
    }, 250);
    void hadLocal;
  }

  return (
    <section className="mt-12">
      <h2 className="font-display text-2xl text-ink mb-4">Activity</h2>

      <Composer
        softAuthed={softAuthed}
        anonName={anonName}
        anonPhone={anonPhone}
        onAnonNameChange={setAnonName}
        onAnonPhoneChange={setAnonPhone}
        onPost={async (payload) => {
          const created = await post(payload);
          if (created) addEntryLocal(created);
          return !!created;
        }}
      />

      {roots.length === 0 ? (
        <p className="text-muted text-sm mt-4">Be the first to say something.</p>
      ) : (
        <ul className="grid gap-3 mt-4">
          {roots.map((root) => (
            <li key={root.id}>
              <EntryCard
                entry={root}
                reactions={reactions.filter((r) => r.entry_id === root.id)}
                onReact={(e) => toggleReaction(root.id, e)}
                canInteract={softAuthed}
                canReply={softAuthed}
                onReply={async (text) => {
                  const created = await post({
                    entry_type: "comment",
                    content: { text },
                    parent_id: root.id,
                  });
                  if (created) addEntryLocal(created);
                  return !!created;
                }}
                replies={repliesByParent.get(root.id) ?? []}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ─── Composer ───────────────────────────────────────────────────

function Composer({
  softAuthed, anonName, anonPhone, onAnonNameChange, onAnonPhoneChange, onPost,
}: {
  softAuthed: boolean;
  anonName: string;
  anonPhone: string;
  onAnonNameChange: (v: string) => void;
  onAnonPhoneChange: (v: string) => void;
  onPost: (payload: { entry_type: string; content: Record<string, unknown> }) => Promise<boolean>;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState<string | null>(null);
  const [showGif, setShowGif] = useState(false);
  const [showAnonId, setShowAnonId] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!text.trim()) return;
    if (!softAuthed && !anonName.trim()) {
      setShowAnonId(true);
      return;
    }
    setBusy(true);
    const ok = await onPost({ entry_type: "comment", content: { text: text.trim() } });
    setBusy(false);
    if (!ok) { setErr("Couldn't post. Try again."); return; }
    setText("");
    setShowAnonId(false);
  }

  async function handleFile(file: File) {
    if (!softAuthed) { setErr("Sign in (RSVP) to post photos."); return; }
    if (!file.type.startsWith("image/")) { setErr("Photos only."); return; }
    if (file.size > 5 * 1024 * 1024) { setErr("Max 5MB."); return; }
    setBusy(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const up = await fetch("/api/uploads/feed-photo", { method: "POST", body: fd });
      const upBody = await up.json();
      if (!up.ok || !upBody.ok) { setErr(upBody?.error?.code ?? "Upload failed."); return; }
      const ok = await onPost({
        entry_type: "photo",
        content: { url: upBody.data.url, caption: text.trim() || null },
      });
      if (!ok) { setErr("Posted photo but couldn't save entry."); return; }
      setText("");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function handleGifPicked(g: { url: string; preview_url: string | null; width: number | null; height: number | null }) {
    setShowGif(false);
    setBusy(true);
    setErr(null);
    const ok = await onPost({
      entry_type: "gif",
      content: {
        url: g.url,
        preview_url: g.preview_url,
        width: g.width,
        height: g.height,
      },
    });
    setBusy(false);
    if (!ok) setErr("Couldn't post the GIF.");
  }

  return (
    <form onSubmit={send} className="bg-card border border-line rounded-2xl p-4 grid gap-3">
      <textarea
        rows={2}
        maxLength={500}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={softAuthed ? "Drop a comment for the group…" : "Comment (we'll ask your name once)"}
        className="rounded-xl border border-line bg-cream-2/40 px-3 py-2 text-ink placeholder:text-muted text-sm focus:border-green focus:outline-none resize-none"
      />
      {!softAuthed && showAnonId && (
        <div className="grid gap-2 sm:grid-cols-2">
          <input
            type="text" maxLength={30} value={anonName} onChange={(e) => onAnonNameChange(e.target.value)}
            placeholder="Your name"
            className="h-11 rounded-xl border border-line bg-cream-2/40 px-3 text-sm text-ink placeholder:text-muted focus:border-green focus:outline-none"
          />
          <input
            type="tel" value={anonPhone} onChange={(e) => onAnonPhoneChange(e.target.value)}
            placeholder="Phone (optional)"
            className="h-11 rounded-xl border border-line bg-cream-2/40 px-3 text-sm text-ink placeholder:text-muted focus:border-green focus:outline-none"
          />
        </div>
      )}
      {err && <p className="text-orange text-xs">{err}</p>}
      <div className="flex items-center justify-between text-xs text-muted">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy || !softAuthed}
            title={softAuthed ? "Attach a photo" : "RSVP to post photos"}
            className="h-9 w-9 rounded-full hover:bg-line/40 disabled:opacity-40 text-lg leading-none"
          >📷</button>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
          />
          <button
            type="button"
            onClick={() => setShowGif(true)}
            disabled={busy || !softAuthed}
            title={softAuthed ? "Pick a GIF" : "RSVP to post GIFs"}
            className="h-9 px-2.5 rounded-full hover:bg-line/40 disabled:opacity-40 text-xs font-bold tracking-widest"
          >GIF</button>
        </div>
        <div className="flex items-center gap-3">
          <span>{text.length}/500</span>
          <button
            type="submit"
            disabled={busy || !text.trim()}
            className="h-10 px-5 rounded-full bg-green text-cream font-bold hover:bg-green-2 disabled:opacity-50 text-sm"
          >{busy ? "Posting…" : "Post"}</button>
        </div>
      </div>

      {showGif && <GifPicker onPick={handleGifPicked} onClose={() => setShowGif(false)} />}
    </form>
  );
}

// ─── Entry card ─────────────────────────────────────────────────

function EntryCard({
  entry, reactions, onReact, canInteract, canReply, onReply, replies,
}: {
  entry: ActivityFeedEntry;
  reactions: ActivityReaction[];
  onReact: (emoji: string) => void;
  canInteract: boolean;
  canReply: boolean;
  onReply: (text: string) => Promise<boolean>;
  replies: ActivityFeedEntry[];
}) {
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [replyBusy, setReplyBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Aggregate reactions by emoji.
  const counts = new Map<string, number>();
  for (const r of reactions) counts.set(r.emoji, (counts.get(r.emoji) ?? 0) + 1);
  const aggregated = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);

  async function submitReply(e: React.FormEvent) {
    e.preventDefault();
    if (!replyText.trim()) return;
    setReplyBusy(true);
    const ok = await onReply(replyText.trim());
    setReplyBusy(false);
    if (ok) {
      setReplyText("");
      setReplyOpen(false);
    }
  }

  return (
    <div className="bg-card border border-line rounded-2xl p-4 text-sm">
      <EntryHeader entry={entry} />
      <EntryBody entry={entry} />

      {/* Reaction summary + action row */}
      <div className="mt-2 flex items-center gap-1.5 flex-wrap">
        {aggregated.map(([emoji, n]) => (
          <button
            key={emoji}
            type="button"
            onClick={() => canInteract && onReact(emoji)}
            disabled={!canInteract}
            className="h-7 px-2 rounded-full bg-cream-2/60 border border-line hover:border-green text-xs disabled:opacity-60"
          >
            <span>{emoji}</span> <span className="text-muted">{n}</span>
          </button>
        ))}
        {canInteract && (
          <div className="relative">
            <button
              type="button"
              onClick={() => setPickerOpen((v) => !v)}
              className="h-7 w-7 rounded-full bg-cream-2/60 border border-line hover:border-green text-xs text-muted"
              title="Add reaction"
            >☺︎</button>
            {pickerOpen && (
              <div className="absolute z-10 left-0 top-9 bg-card border border-line rounded-full px-2 py-1 shadow-lg flex gap-1">
                {REACTION_PALETTE.map((e) => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => { onReact(e); setPickerOpen(false); }}
                    className="h-8 w-8 rounded-full hover:bg-cream-2/60 text-base"
                  >{e}</button>
                ))}
              </div>
            )}
          </div>
        )}
        {canReply && (
          <button
            type="button"
            onClick={() => setReplyOpen((v) => !v)}
            className="ml-auto h-7 px-2 rounded-full text-xs text-muted hover:text-ink hover:bg-cream-2/60"
          >{replyOpen ? "Cancel" : "Reply"}</button>
        )}
      </div>

      {/* Inline reply composer */}
      {replyOpen && (
        <form onSubmit={submitReply} className="mt-3 grid gap-2">
          <textarea
            rows={1}
            maxLength={300}
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            placeholder="Reply…"
            className="rounded-xl border border-line bg-cream-2/40 px-3 py-2 text-ink placeholder:text-muted text-sm focus:border-green focus:outline-none resize-none"
          />
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={replyBusy || !replyText.trim()}
              className="h-9 px-4 rounded-full bg-green text-cream font-bold text-xs hover:bg-green-2 disabled:opacity-50"
            >{replyBusy ? "…" : "Reply"}</button>
          </div>
        </form>
      )}

      {/* Replies */}
      {replies.length > 0 && (
        <ul className="mt-3 ml-4 pl-3 border-l-2 border-line grid gap-2.5">
          {replies.map((reply) => (
            <li key={reply.id}>
              <EntryHeader entry={reply} compact />
              <EntryBody entry={reply} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EntryHeader({ entry, compact = false }: { entry: ActivityFeedEntry; compact?: boolean }) {
  return (
    <p className={`uppercase tracking-widest text-muted font-semibold mb-1 ${compact ? "text-[10px]" : "text-xs"}`}>
      {formatHeader(entry)} · {formatRelative(entry.created_at)}
    </p>
  );
}

function EntryBody({ entry }: { entry: ActivityFeedEntry }) {
  const c = entry.content as Record<string, unknown>;
  if (entry.entry_type === "gif" && typeof c.url === "string") {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={c.url} alt="" className="rounded-xl mt-1 max-h-72" />;
  }
  if (entry.entry_type === "photo" && typeof c.url === "string") {
    return (
      <div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={c.url} alt={(c.caption as string) || ""} className="rounded-xl mt-1 max-h-96" />
        {typeof c.caption === "string" && c.caption && (
          <p className="text-ink mt-1.5">{c.caption}</p>
        )}
      </div>
    );
  }
  return <p className="text-ink whitespace-pre-line">{formatBody(entry)}</p>;
}

// ─── GIF picker (Tenor proxy) ───────────────────────────────────

interface GifResult {
  id: string;
  title: string;
  url: string | null;
  preview_url: string | null;
  width: number | null;
  height: number | null;
}

function GifPicker({
  onPick, onClose,
}: { onPick: (g: { url: string; preview_url: string | null; width: number | null; height: number | null }) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<GifResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function search(query: string) {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`/api/gifs/search?q=${encodeURIComponent(query)}&limit=16`, { cache: "no-store" });
      const body = await r.json();
      if (!r.ok || !body.ok) {
        setErr(
          body?.error?.code === "key_missing"
            ? "GIF search isn't configured yet. Ask the Rally team to add TENOR_API_KEY."
            : "GIF search hit a snag.",
        );
        setResults([]);
        return;
      }
      setResults(body.data.gifs as GifResult[]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-cream w-full sm:max-w-xl sm:rounded-[28px] rounded-t-[28px] max-h-[88dvh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-3.5 border-b border-line flex items-center gap-3">
          <button onClick={onClose} aria-label="Close" className="h-9 w-9 rounded-full hover:bg-line/40 text-ink text-xl leading-none">×</button>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); search(q); } }}
            placeholder="Search GIFs…"
            className="flex-1 h-10 rounded-full bg-card border border-line px-4 text-sm text-ink placeholder:text-muted focus:border-green focus:outline-none"
            autoFocus
          />
          <button onClick={() => search(q)} disabled={busy || !q.trim()} className="h-10 px-4 rounded-full bg-green text-cream font-bold text-sm disabled:opacity-50">Go</button>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          {err && <p className="text-orange text-sm px-2 py-3">{err}</p>}
          {!err && results.length === 0 && !busy && (
            <p className="text-muted text-sm px-2 py-6 text-center">Type something to search.</p>
          )}
          {busy && <p className="text-muted text-sm px-2 py-3">Searching…</p>}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {results.map((g) => g.url && (
              <button
                key={g.id}
                type="button"
                onClick={() => onPick({ url: g.url!, preview_url: g.preview_url, width: g.width, height: g.height })}
                className="aspect-video bg-cream-2/40 rounded-xl overflow-hidden hover:ring-2 ring-green"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={g.preview_url ?? g.url} alt={g.title} className="w-full h-full object-cover" />
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────

function formatHeader(e: ActivityFeedEntry): string {
  const c = e.content as Record<string, unknown>;
  if (e.entry_type === "comment" && typeof c.name === "string") return c.name;
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
  if (typeof c.name === "string" && typeof c.status === "string") return `${c.name} → ${c.status}`;
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
