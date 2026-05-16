"use client";

/**
 * Editable hero — split into two exports so the layout can place
 * the cover image and the trip metadata in separate grid columns.
 *
 * • <EditableCover>        cover image surface + click-to-edit
 *                          modal + loading placeholder while a
 *                          cover-image generation job is in flight
 * • <EditableTripHeader>   eyebrow (Live/Draft + theme name) +
 *                          name + destination + dates + book-by
 *
 * Trip layout renders these in a 2-col grid on lg+ (cover left,
 * sticky as the user scrolls; meta + tabs + content scrolling on
 * the right). On smaller screens they stack — cover first, then
 * meta. Each component owns its own local-state slice; the only
 * shared concern is the PATCH endpoint, which both call directly.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { themeClass } from "@/lib/themes";
import { EditableText } from "@/lib/editable";
import { useGeneration } from "@/lib/generation/provider";
import TravelLoadingDance from "@/lib/generation/loading-art";
import type { Trip } from "@shared/types";
import CoverEditor from "./cover-editor";

interface CoverFields {
  name:            string;
  cover_image_url: string | null;
  theme:           Trip["theme"];
}

interface HeaderFields {
  name:         string;
  destination:  string | null;
  start_date:   string | null;
  end_date:     string | null;
  book_by_date: string | null;
  theme:        Trip["theme"];
  status:       string;
}

// ─── EditableCover ─────────────────────────────────────────────────

export function EditableCover({
  tripId,
  canEdit,
  initial,
}: {
  tripId: string;
  canEdit: boolean;
  initial: CoverFields;
}) {
  const router = useRouter();
  const [cover, setCover]   = useState<string | null>(initial.cover_image_url);
  const [coverOpen, setCoverOpen] = useState(false);
  const generation = useGeneration();
  const coverBusy = generation.isRunning("cover-image");
  const t = themeClass(initial.theme);

  async function patch(fields: { cover_image_url: string | null }) {
    const res = await fetch(`/api/trips/${tripId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
    const body = await res.json();
    if (!res.ok || !body.ok) {
      throw new Error(body?.error?.code || `Update failed (${res.status})`);
    }
    setCover(fields.cover_image_url);
    router.refresh();
  }

  // Shared classes — same aspect ratio + rounded shape across all
  // three render states (busy / cover present / no cover). Square
  // so it pairs cleanly with the sticky vertical-center positioning
  // on lg+ (taller portrait would collide with the viewport edges
  // on shorter screens; landscape would feel mismatched against
  // the scrolling text column).
  const FRAME = "block w-full aspect-square rounded-[28px] relative overflow-hidden";

  if (coverBusy) {
    return (
      <div
        className={`${FRAME} ${cover ? "bg-cover bg-center" : t.cover}`}
        style={cover ? { backgroundImage: `url(${escapeCss(cover)})` } : undefined}
        aria-label="Generating cover image"
        role="status"
      >
        <div className="absolute inset-0 bg-ink/60 backdrop-blur-sm" aria-hidden />
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-cream">
          <div className="scale-150">
            <TravelLoadingDance />
          </div>
          <p className="text-sm font-semibold tracking-wide">Cooking up your cover…</p>
          <p className="text-xs opacity-80 text-center max-w-[80%]">
            Keep planning — we&rsquo;ll drop it in when it&rsquo;s ready.
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      {cover ? (
        <button
          type="button"
          onClick={() => canEdit && setCoverOpen(true)}
          disabled={!canEdit}
          className={`${FRAME} bg-cover bg-center bg-cream-2 group ${canEdit ? "cursor-pointer" : ""}`}
          style={{ backgroundImage: `url(${escapeCss(cover)})` }}
          aria-label={canEdit ? "Change cover image" : undefined}
        >
          {canEdit && (
            <span className="absolute bottom-3 right-3 bg-ink/70 text-cream text-xs font-semibold px-3 py-1.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity">
              ✎ Change cover
            </span>
          )}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => canEdit && setCoverOpen(true)}
          disabled={!canEdit}
          className={`${FRAME} ${t.cover} group ${canEdit ? "cursor-pointer" : ""}`}
          aria-label={canEdit ? "Add cover image" : undefined}
        >
          <div className="h-full flex items-center justify-center px-6">
            <span className={`text-3xl sm:text-4xl text-center ${t.coverInk}`}>
              {initial.name}
            </span>
          </div>
          {canEdit && (
            <span className="absolute bottom-3 right-3 bg-ink/70 text-cream text-xs font-semibold px-3 py-1.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity">
              ✎ Add cover
            </span>
          )}
        </button>
      )}

      {coverOpen && (
        <CoverEditor
          tripId={tripId}
          currentUrl={cover}
          tripName={initial.name}
          onClose={() => setCoverOpen(false)}
          onSave={(newUrl) => patch({ cover_image_url: newUrl })}
        />
      )}
    </>
  );
}

// ─── EditableTripHeader ────────────────────────────────────────────

export function EditableTripHeader({
  tripId,
  canEdit,
  initial,
}: {
  tripId: string;
  canEdit: boolean;
  initial: HeaderFields;
}) {
  const router = useRouter();
  const [fields, setFields] = useState<HeaderFields>(initial);
  const t = themeClass(fields.theme);

  async function patch(p: Partial<HeaderFields>) {
    const res = await fetch(`/api/trips/${tripId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(p),
    });
    const body = await res.json();
    if (!res.ok || !body.ok) {
      throw new Error(body?.error?.code || `Update failed (${res.status})`);
    }
    setFields((prev) => ({ ...prev, ...p }));
    router.refresh();
  }

  return (
    <header>
      {/* Status / theme eyebrow removed — "Live" and the theme name
          were noise for both planners and respondents (they can see
          the theme by looking at the page, and "Live" is the default
          state). Draft status is still surfaced as a small badge
          below when relevant. */}
      {fields.status === "draft" && (
        <p className={`text-[11px] mb-2 ${t.eyebrow}`}>Draft</p>
      )}

      <h1 className={`text-3xl sm:text-4xl leading-tight mb-2 ${t.display}`}>
        <EditableText
          value={fields.name}
          canEdit={canEdit}
          placeholder="Trip name"
          onSave={async (v) => { if (v) await patch({ name: v }); }}
          inputClass="text-3xl sm:text-4xl"
          displayClass="font-display"
        />
      </h1>

      <p className={`mb-1 ${t.body}`}>
        <EditableText
          value={fields.destination}
          canEdit={canEdit}
          placeholder="Add a destination"
          onSave={(v) => patch({ destination: v })}
        />
        {" · "}
        <EditableText
          value={fields.start_date}
          canEdit={canEdit}
          type="date"
          placeholder="Start date"
          renderDisplay={(v) => v ? formatDate(v) : <span className="opacity-50">Start date</span>}
          onSave={(v) => patch({ start_date: v })}
        />
        {" → "}
        <EditableText
          value={fields.end_date}
          canEdit={canEdit}
          type="date"
          placeholder="End date"
          renderDisplay={(v) => v ? formatDate(v) : <span className="opacity-50">End date</span>}
          onSave={(v) => patch({ end_date: v })}
        />
      </p>

      {canEdit && (
        <p className={`mb-4 text-xs ${t.meta}`}>
          Book by:{" "}
          <EditableText
            value={fields.book_by_date}
            canEdit={canEdit}
            type="date"
            placeholder="set deadline"
            renderDisplay={(v) => v ? formatDate(v) : <span className="opacity-50">set deadline</span>}
            onSave={(v) => patch({ book_by_date: v })}
            displayClass={t.meta}
          />
        </p>
      )}
    </header>
  );
}

// ─── Backwards-compat default export ──────────────────────────────

export default function EditableHero({
  tripId,
  canEdit,
  initial,
}: {
  tripId: string;
  canEdit: boolean;
  initial: HeaderFields & CoverFields;
}) {
  return (
    <>
      <EditableCover
        tripId={tripId}
        canEdit={canEdit}
        initial={{
          name:            initial.name,
          cover_image_url: initial.cover_image_url,
          theme:           initial.theme,
        }}
      />
      <div className="mt-6">
        <EditableTripHeader tripId={tripId} canEdit={canEdit} initial={initial} />
      </div>
    </>
  );
}

// ─── helpers ───────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

function escapeCss(url: string): string {
  return url.replace(/[()'"\\]/g, "\\$&");
}
