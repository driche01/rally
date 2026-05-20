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

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { themeClass } from "@/lib/themes";
import { EditableText } from "@/lib/editable";
import { useGeneration } from "@/lib/generation/provider";
import TravelLoadingDance from "@/lib/generation/loading-art";
import type { Trip } from "@shared/types";
import CoverEditor from "./cover-editor";
import PlacesAutocompleteInput from "@/lib/ui/places-autocomplete-input";

interface CoverFields {
  name:            string;
  cover_image_url: string | null;
  theme:           Trip["theme"];
  // Optional date hints — themes with a CoverArt component (e.g.
  // Literary) use these to render issue dates, season callouts, etc.
  start_date?:     string | null;
  end_date?:       string | null;
}

interface HeaderFields {
  name:                  string;
  destination:           string | null;
  // Alpha+ — populated by the places autocomplete when the planner
  // picks a suggestion. Full address ("Paris, France") + Google's
  // stable place_id. NULL = freeform destination never reconciled.
  destination_address:   string | null;
  destination_place_id:  string | null;
  start_date:            string | null;
  end_date:              string | null;
  book_by_date:          string | null;
  theme:                 Trip["theme"];
  status:                string;
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

  // Re-sync local state when the server prop changes. Background
  // generation (e.g., AI cover image) finishes outside this component,
  // calls router.refresh() in the GenerationProvider, and the new URL
  // arrives via fresh server props. Without this effect, the local
  // `cover` state stays stuck on the original value and the planner
  // has to reload the page to see the generated cover.
  useEffect(() => {
    setCover(initial.cover_image_url);
  }, [initial.cover_image_url]);

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
          {t.CoverArt ? (
            // Theme owns the entire composition — coverInk + the
            // default centered-name overlay are skipped. The theme's
            // `cover` classes still provide the container (border,
            // background tone, overflow-hidden), so the CoverArt
            // component just paints inside.
            <t.CoverArt
              tripName={initial.name}
              startDate={initial.start_date ?? null}
              endDate={initial.end_date ?? null}
            />
          ) : (
            <div className="h-full flex items-center justify-center px-6">
              <span className={`text-3xl sm:text-4xl text-center ${t.coverInk}`}>
                {initial.name}
              </span>
            </div>
          )}
          {canEdit && (
            <span className="absolute bottom-3 right-3 bg-ink/70 text-cream text-xs font-semibold px-3 py-1.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity z-10">
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
  const searchParams = useSearchParams();
  // ?new=1 is set by CreateTripButton when redirecting from the
  // "+ New trip" action. Treat it as "open the name editor on first
  // paint so the planner starts typing immediately." Stays per-mount
  // (React state, not URL-derived on every render) so the editor
  // doesn't re-open after the planner has dismissed it once.
  const [fields, setFields] = useState<HeaderFields>(initial);
  const [autoEditName] = useState(() => searchParams.get("new") === "1");
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
          // displayClass intentionally NOT set to "font-display" — the
          // outer <h1> carries the theme's `t.display` class, which is
          // what we want to win (mono for digital, Fredoka One for
          // every other theme). Hard-coding font-display here would
          // override the theme and force Fredoka One regardless.
          autoEdit={autoEditName}
        />
      </h1>

      {/* The destination/dates row used to be a <p>, but the Places
          autocomplete (and its <ul> dropdown) can't legally nest inside
          <p> per HTML spec — that triggers a React hydration error.
          <div> is the right semantic anyway: this is a metadata strip
          of editable controls, not a paragraph of text. */}
      <div className={`mb-1 ${t.body}`}>
        <EditableDestination
          value={fields.destination}
          canEdit={canEdit}
          onPickPlace={async (mainText, fullAddress, placeId) => {
            // Atomic write — all three fields land in one PATCH so we
            // never have a moment where destination is set but the
            // structured place data is stale from a prior selection.
            await patch({
              destination:          mainText,
              destination_address:  fullAddress,
              destination_place_id: placeId,
            });
          }}
          onCommitFreeform={async (text) => {
            // The planner typed something and committed without picking
            // a suggestion. Save the text but null the structured fields
            // so we don't carry stale place data forward.
            await patch({
              destination:          text,
              destination_address:  null,
              destination_place_id: null,
            });
          }}
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
      </div>

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

// ─── EditableDestination ───────────────────────────────────────────
//
// Tap-to-edit destination row that uses the Google Places autocomplete
// in edit mode. Mirrors the EditableText display/edit toggle pattern,
// but the editor is the places dropdown instead of a bare <input>.
//
// Two save paths:
//   - onPickPlace        — user picked a suggestion; structured data lands
//   - onCommitFreeform   — user typed + blurred without picking; freeform text

function EditableDestination({
  value,
  canEdit,
  onPickPlace,
  onCommitFreeform,
}: {
  value: string | null;
  canEdit: boolean;
  onPickPlace:      (mainText: string, fullAddress: string, placeId: string) => Promise<void>;
  onCommitFreeform: (text: string | null) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState(value ?? "");
  const [err, setErr]         = useState<string | null>(null);

  if (!canEdit) {
    return value
      ? <span>{value}</span>
      : <span className="opacity-50">Add a destination</span>;
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => { setDraft(value ?? ""); setEditing(true); }}
        className="inline-flex items-baseline gap-1 text-left cursor-text rounded-md hover:bg-green-soft/40 hover:px-1.5 -mx-1.5 px-1.5 transition-colors"
        aria-label="Edit destination"
      >
        <span>{value ?? <span className="opacity-50">Add a destination</span>}</span>
        <span aria-hidden className="text-xs opacity-30 ml-0.5">✎</span>
      </button>
    );
  }

  async function handlePick(mainText: string, fullAddress: string, placeId: string) {
    setErr(null);
    try {
      await onPickPlace(mainText, fullAddress, placeId);
      setEditing(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    }
  }

  async function handleFreeformCommit(text: string) {
    const trimmed = text.trim();
    // No-op if unchanged.
    if (trimmed === (value ?? "")) {
      setEditing(false);
      return;
    }
    setErr(null);
    try {
      await onCommitFreeform(trimmed === "" ? null : trimmed);
      setEditing(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    }
  }

  return (
    <span className="inline-block min-w-[12rem] align-middle">
      <PlacesAutocompleteInput
        value={draft}
        onChangeText={setDraft}
        onSelectPlace={handlePick}
        onCommit={handleFreeformCommit}
        placeholder="Search a city, region, or venue…"
        autoFocus
      />
      {err && <span className="block text-xs text-orange mt-1">{err}</span>}
    </span>
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
