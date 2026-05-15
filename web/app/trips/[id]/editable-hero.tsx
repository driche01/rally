"use client";

/**
 * Editable hero — cover image, trip name, destination, dates, theme
 * status badge. Renders display-only when canEdit=false; renders
 * click-to-edit affordances for the planner/cohost.
 *
 * Owns three concerns:
 *   1. Click cover → opens CoverEditor modal
 *   2. Click name / destination / dates / book_by → inline edit
 *   3. PATCH on save, then router.refresh() so subsequent reads pick
 *      up the new values
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { themeClass } from "@/lib/themes";
import { EditableText } from "@/lib/editable";
import type { Trip } from "@shared/types";
import CoverEditor from "./cover-editor";

interface EditableTripFields {
  name: string;
  destination: string | null;
  start_date: string | null;
  end_date: string | null;
  book_by_date: string | null;
  cover_image_url: string | null;
  theme: Trip["theme"];
  status: string;
}

export default function EditableHero({
  tripId,
  canEdit,
  initial,
}: {
  tripId: string;
  canEdit: boolean;
  initial: EditableTripFields;
}) {
  const router = useRouter();
  const [trip, setTrip] = useState<EditableTripFields>(initial);
  const [coverOpen, setCoverOpen] = useState(false);
  const t = themeClass(trip.theme);

  async function patch(fields: Partial<EditableTripFields>) {
    const res = await fetch(`/api/trips/${tripId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
    const body = await res.json();
    if (!res.ok || !body.ok) {
      throw new Error(body?.error?.code || `Update failed (${res.status})`);
    }
    setTrip((prev) => ({ ...prev, ...fields }));
    router.refresh();
  }

  return (
    <>
      {/* ─── Hero (cover or theme gradient) ─────────────── */}
      {trip.cover_image_url ? (
        <button
          type="button"
          onClick={() => canEdit && setCoverOpen(true)}
          disabled={!canEdit}
          className={
            "block aspect-[16/10] w-full rounded-[28px] mb-6 bg-cover bg-center bg-cream-2 relative group " +
            (canEdit ? "cursor-pointer" : "")
          }
          style={{ backgroundImage: `url(${escapeCss(trip.cover_image_url)})` }}
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
          className={`block aspect-[16/10] w-full rounded-[28px] mb-6 ${t.cover} relative group ${canEdit ? "cursor-pointer" : ""}`}
          aria-label={canEdit ? "Add cover image" : undefined}
        >
          <div className="h-full flex items-center justify-center px-6">
            <span className={`text-3xl sm:text-4xl text-center ${t.coverInk}`}>
              {trip.name}
            </span>
          </div>
          {canEdit && (
            <span className="absolute bottom-3 right-3 bg-ink/70 text-cream text-xs font-semibold px-3 py-1.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity">
              ✎ Add cover
            </span>
          )}
        </button>
      )}

      {/* ─── Compact header ───────────────────────────── */}
      <p className={`text-[11px] mb-2 ${t.eyebrow}`}>
        {trip.status === "draft" ? "Draft" : "Live"} · {trip.theme ?? "no theme yet"}
      </p>

      <h1 className={`text-3xl sm:text-4xl leading-tight mb-2 ${t.display}`}>
        <EditableText
          value={trip.name}
          canEdit={canEdit}
          placeholder="Trip name"
          onSave={async (v) => { if (v) await patch({ name: v }); }}
          inputClass="text-3xl sm:text-4xl"
          displayClass="font-display"
        />
      </h1>

      <p className={`mb-1 ${t.body}`}>
        <EditableText
          value={trip.destination}
          canEdit={canEdit}
          placeholder="Add a destination"
          onSave={(v) => patch({ destination: v })}
        />
        {" · "}
        <EditableText
          value={trip.start_date}
          canEdit={canEdit}
          type="date"
          placeholder="Start date"
          renderDisplay={(v) => v ? formatDate(v) : <span className="opacity-50">Start date</span>}
          onSave={(v) => patch({ start_date: v })}
        />
        {" → "}
        <EditableText
          value={trip.end_date}
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
            value={trip.book_by_date}
            canEdit={canEdit}
            type="date"
            placeholder="set deadline"
            renderDisplay={(v) => v ? formatDate(v) : <span className="opacity-50">set deadline</span>}
            onSave={(v) => patch({ book_by_date: v })}
            displayClass={t.meta}
          />
        </p>
      )}

      {coverOpen && (
        <CoverEditor
          currentUrl={trip.cover_image_url}
          tripName={trip.name}
          onClose={() => setCoverOpen(false)}
          onSave={(newUrl) => patch({ cover_image_url: newUrl })}
        />
      )}
    </>
  );
}

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

function escapeCss(url: string): string {
  return url.replace(/[()'"\\]/g, "\\$&");
}
