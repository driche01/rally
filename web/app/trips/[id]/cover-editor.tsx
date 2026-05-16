"use client";

/**
 * Cover-image editor modal. Opens from the editable hero when the
 * planner taps the cover image. Three modes: upload an image,
 * generate one via Gemini from a prompt, or paste a URL directly.
 *
 * Generate + Upload run in the background via the GenerationProvider
 * — the modal closes immediately on click and the hero shows a
 * loading placeholder until the new image is ready. URL paste stays
 * synchronous because the round-trip is fast (just a PATCH).
 */

import { useRef, useState } from "react";
import { useGeneration } from "@/lib/generation/provider";

type Mode = "upload" | "generate" | "url";

export default function CoverEditor({
  tripId,
  currentUrl,
  tripName,
  onClose,
  onSave,
}: {
  tripId: string;
  currentUrl: string | null;
  tripName: string;
  onClose: () => void;
  onSave: (newUrl: string | null) => Promise<void>;
}) {
  const generation = useGeneration();
  const [mode, setMode] = useState<Mode>("upload");
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [urlInput, setUrlInput] = useState(currentUrl ?? "");
  const fileRef = useRef<HTMLInputElement>(null);

  function onUpload(file: File) {
    setErr(null);
    if (!file.type.startsWith("image/")) {
      setErr("That doesn't look like an image.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setErr("Max 5MB.");
      return;
    }
    // Background: kick off upload → PATCH chain through the provider,
    // close the modal immediately so the user can keep planning.
    // The hero shows a loading placeholder until the new cover lands.
    generation.start({
      kind: "cover-image",
      label: "Uploading cover…",
      fetcher: async () => {
        const fd = new FormData();
        fd.append("file", file);
        const r = await fetch("/api/uploads/cover", { method: "POST", body: fd });
        if (!r.ok) return r;
        const body = await r.json();
        const url = body?.data?.url as string | undefined;
        if (!url) return new Response(JSON.stringify({ ok: false, error: { code: "no_url" } }), { status: 500 });
        return fetch(`/api/trips/${tripId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cover_image_url: url }),
        });
      },
    });
    onClose();
  }

  function onGenerate() {
    setErr(null);
    if (!prompt.trim()) { setErr("Type a prompt first."); return; }
    const p = prompt.trim();
    generation.start({
      kind: "cover-image",
      label: "Generating cover…",
      fetcher: async () => {
        const r = await fetch("/api/uploads/generate-cover", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: p }),
        });
        if (!r.ok) return r;
        const body = await r.json();
        const url = body?.data?.url as string | undefined;
        if (!url) return new Response(JSON.stringify({ ok: false, error: { code: "no_url" } }), { status: 500 });
        return fetch(`/api/trips/${tripId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cover_image_url: url }),
        });
      },
    });
    onClose();
  }

  async function onSaveUrl() {
    setErr(null);
    const u = urlInput.trim();
    if (!u) {
      // Empty = clear cover.
      setBusy(true);
      try { await onSave(null); onClose(); }
      catch (e) { setErr(e instanceof Error ? e.message : "Save failed"); }
      finally { setBusy(false); }
      return;
    }
    if (!/^https?:\/\//.test(u)) {
      setErr("URL must start with http:// or https://");
      return;
    }
    setBusy(true);
    try {
      await onSave(u);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="dialog" aria-modal="true"
      onClick={onClose}
    >
      <div
        className="bg-cream w-full sm:max-w-lg sm:rounded-[28px] rounded-t-[28px] max-h-[92dvh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-5 border-b border-line flex items-start justify-between">
          <div>
            <p className="text-xs font-bold tracking-widest uppercase text-green mb-1">Cover image</p>
            <h2 className="font-display text-2xl text-ink">{tripName}</h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="h-10 w-10 rounded-full hover:bg-line/40 text-ink text-2xl leading-none -mr-2"
          >×</button>
        </div>

        <div className="px-6 py-5 grid gap-5">
          {currentUrl && (
            <img
              src={currentUrl}
              alt=""
              className="w-full aspect-square rounded-2xl object-cover border border-line"
            />
          )}

          <div className="flex gap-2">
            {(["upload","generate","url"] as Mode[]).map((m) => (
              <button
                key={m}
                onClick={() => { setMode(m); setErr(null); }}
                className={
                  mode === m
                    ? "h-9 px-3 rounded-full bg-green text-cream font-semibold text-sm"
                    : "h-9 px-3 rounded-full bg-card text-ink border border-line text-sm hover:border-green"
                }
              >
                {m === "upload" ? "Upload" : m === "generate" ? "AI Generate" : "Paste URL"}
              </button>
            ))}
          </div>

          {mode === "upload" && (
            <div className="grid gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onUpload(f);
                }}
                className="text-sm"
                disabled={busy}
              />
              <p className="text-xs text-muted">JPG / PNG / WebP up to 5MB.</p>
            </div>
          )}

          {mode === "generate" && (
            <div className="grid gap-2">
              <textarea
                rows={3}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="e.g. moody sunset over Tulum cenote, vintage film grain, warm tones"
                className="rounded-xl border border-line bg-card px-4 py-2 text-ink text-sm placeholder:text-muted focus:border-green focus:outline-none"
                disabled={busy}
              />
              <button
                onClick={onGenerate}
                disabled={!prompt.trim()}
                className="h-11 rounded-full bg-green text-cream font-bold hover:bg-green-2 disabled:opacity-50"
              >
                Generate cover →
              </button>
              <p className="text-xs text-muted">
                Generation runs in the background. You can keep planning while it cooks.
              </p>
            </div>
          )}

          {mode === "url" && (
            <div className="grid gap-2">
              <input
                type="url"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="https://…"
                className="h-11 rounded-xl border border-line bg-card px-4 text-ink placeholder:text-muted focus:border-green focus:outline-none"
                disabled={busy}
              />
              <div className="flex gap-2">
                <button
                  onClick={onSaveUrl}
                  disabled={busy}
                  className="h-11 px-5 rounded-full bg-green text-cream font-bold hover:bg-green-2 disabled:opacity-50"
                >
                  {busy ? "Saving…" : "Save"}
                </button>
                {currentUrl && (
                  <button
                    onClick={async () => {
                      setBusy(true);
                      try { await onSave(null); onClose(); }
                      catch (e) { setErr(e instanceof Error ? e.message : "Save failed"); }
                      finally { setBusy(false); }
                    }}
                    disabled={busy}
                    className="h-11 px-5 rounded-full bg-card text-orange border border-orange/40 hover:bg-orange/10 disabled:opacity-50"
                  >
                    Remove cover
                  </button>
                )}
              </div>
            </div>
          )}

          {err && <p className="text-orange text-sm">{err}</p>}
        </div>
      </div>
    </div>
  );
}
