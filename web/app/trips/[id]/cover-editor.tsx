"use client";

/**
 * Cover-image editor modal. Opens from the editable hero when the
 * planner taps the cover image. Three modes: upload an image,
 * generate one via Gemini from a prompt, or paste a URL directly.
 *
 * Reuses the existing /api/uploads/cover (upload) +
 * /api/uploads/generate-cover (Gemini) endpoints. On save, the
 * caller is responsible for PATCHing the trip's cover_image_url.
 */

import { useRef, useState } from "react";

type Mode = "upload" | "generate" | "url";

export default function CoverEditor({
  currentUrl,
  tripName,
  onClose,
  onSave,
}: {
  currentUrl: string | null;
  tripName: string;
  onClose: () => void;
  onSave: (newUrl: string | null) => Promise<void>;
}) {
  const [mode, setMode] = useState<Mode>("upload");
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [urlInput, setUrlInput] = useState(currentUrl ?? "");
  const fileRef = useRef<HTMLInputElement>(null);

  async function onUpload(file: File) {
    setErr(null);
    if (!file.type.startsWith("image/")) {
      setErr("That doesn't look like an image.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setErr("Max 5MB.");
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/uploads/cover", { method: "POST", body: fd });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        setErr(body?.error?.code ?? "Upload failed");
        return;
      }
      await onSave(body.data.url);
      onClose();
    } catch {
      setErr("Couldn't reach Rally. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function onGenerate() {
    setErr(null);
    if (!prompt.trim()) { setErr("Type a prompt first."); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/uploads/generate-cover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: prompt.trim() }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        setErr(body?.error?.code ?? "Generate failed");
        return;
      }
      await onSave(body.data.url);
      onClose();
    } catch {
      setErr("Couldn't reach Rally. Try again.");
    } finally {
      setBusy(false);
    }
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
              className="w-full aspect-[16/10] rounded-2xl object-cover border border-line"
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
                disabled={busy || !prompt.trim()}
                className="h-11 rounded-full bg-green text-cream font-bold hover:bg-green-2 disabled:opacity-50"
              >
                {busy ? "Generating…" : "Generate cover →"}
              </button>
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
