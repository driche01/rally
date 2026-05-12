"use client";

/**
 * FlyerModal — calls /api/trips/[id]/flyer/generate, shows the rendered
 * story + post images, lets the planner download or copy each URL.
 *
 * Phase B Step 3. Single-template-but-theme-aware render. The button
 * that opens this modal lives on the planner dashboard.
 */

import { useState } from "react";

interface FlyerOut {
  format: "story" | "post";
  url: string;
  id: string;
}

export default function FlyerModal({
  tripId,
  onClose,
}: {
  tripId: string;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState<string | null>(null);
  const [flyers, setFlyers] = useState<FlyerOut[] | null>(null);

  async function generate() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/trips/${tripId}/flyer/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format: "both" }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        setErr(body?.error?.message || body?.error?.code || `Generation failed (${res.status})`);
        return;
      }
      setFlyers(body.data.flyers as FlyerOut[]);
    } catch {
      setErr("Couldn't reach Rally. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="bg-cream w-full sm:max-w-2xl sm:rounded-[28px] rounded-t-[28px] max-h-[92dvh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-5 sm:py-6 border-b border-line flex items-start justify-between">
          <div>
            <p className="text-xs font-bold tracking-widest uppercase text-green mb-1">
              Generate flyer
            </p>
            <h2 className="font-display text-2xl text-ink">Shareable for stories &amp; posts</h2>
            <p className="text-muted text-sm mt-2">
              We&apos;ll render two formats — Instagram story (1080×1920) and Instagram post (1080×1080).
              The flyer&apos;s look follows your trip&apos;s theme.
            </p>
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
          {flyers ? (
            <FlyerPreview flyers={flyers} onRegenerate={() => { setFlyers(null); }} />
          ) : (
            <div className="grid gap-4">
              <p className="text-ink text-sm">
                One tap and we&apos;ll generate both formats. Renders in ~3 seconds.
              </p>
              {err && <p className="text-orange text-sm">{err}</p>}
              <button
                onClick={generate}
                disabled={busy}
                className="h-12 px-6 rounded-full bg-green text-cream font-bold hover:bg-green-2 disabled:opacity-60"
              >
                {busy ? "Rendering…" : "Generate flyer →"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function FlyerPreview({
  flyers,
  onRegenerate,
}: {
  flyers: FlyerOut[];
  onRegenerate: () => void;
}) {
  const story = flyers.find((f) => f.format === "story");
  const post  = flyers.find((f) => f.format === "post");
  return (
    <div className="grid gap-5">
      <div className="grid sm:grid-cols-2 gap-4">
        {story && <FlyerCard label="Story · 1080×1920" url={story.url} aspect="9/16" />}
        {post  && <FlyerCard label="Post · 1080×1080"  url={post.url}  aspect="1/1"  />}
      </div>
      <p className="text-muted text-xs">
        Long-press on mobile to save, or use the buttons.
      </p>
      <div className="flex flex-col sm:flex-row sm:justify-end gap-2">
        <button
          onClick={onRegenerate}
          className="h-11 px-5 rounded-full bg-card text-ink border border-line hover:border-green text-sm"
        >
          Regenerate
        </button>
      </div>
    </div>
  );
}

function FlyerCard({ label, url, aspect }: { label: string; url: string; aspect: string }) {
  async function copy() {
    try { await navigator.clipboard.writeText(url); } catch {}
  }
  return (
    <div className="grid gap-2">
      <p className="text-[11px] tracking-widest uppercase font-bold text-green">{label}</p>
      <div
        className="rounded-[18px] overflow-hidden bg-card border border-line"
        style={{ aspectRatio: aspect }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={label} className="w-full h-full object-cover" />
      </div>
      <div className="flex gap-2">
        <a
          href={url}
          target="_blank"
          rel="noopener"
          download
          className="h-10 px-4 rounded-full bg-green text-cream font-bold text-xs inline-flex items-center hover:bg-green-2"
        >
          Open / download
        </a>
        <button
          onClick={copy}
          className="h-10 px-4 rounded-full bg-card text-ink border border-line hover:border-green text-xs"
        >
          Copy URL
        </button>
      </div>
    </div>
  );
}
