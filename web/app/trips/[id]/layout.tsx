/**
 * /trips/[id]/layout.tsx — shared chrome across every dashboard tab.
 *
 * Renders: theme-aware hero (cover image or theme gradient) +
 * compact trip header + TabNav. Children mount below.
 *
 * This is where auth + theme propagation live now (in Phase A both
 * lived in /trips/[id]/page.tsx). Tabs reuse the same layout, so
 * the hero + theme treatment are consistent across Overview /
 * Itinerary / Lodging / Travel / Meals / Shopping.
 */

import { notFound, redirect } from "next/navigation";
import { requireAuthUid } from "@/lib/auth";
import { themeClass } from "@/lib/themes";
import type { Trip } from "@shared/types";
import TabNav from "./tabs";

export default async function TripLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const r = await requireAuthUid();
  if (!r.ok) redirect(`/login?next=/trips/${id}`);

  const { data: tripRow, error } = await r.supabase
    .from("trips")
    .select("id, name, destination, start_date, end_date, theme, cover_image_url, status, share_token, created_by")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    return (
      <main className="min-h-dvh flex items-center justify-center p-6">
        <p className="text-orange">Couldn&apos;t load trip: {error.message}</p>
      </main>
    );
  }
  if (!tripRow) notFound();
  const trip = tripRow as Pick<Trip, "id" | "name" | "destination" | "start_date" | "end_date" | "theme" | "cover_image_url" | "status" | "share_token" | "created_by">;

  const t = themeClass(trip.theme);

  return (
    <main className={`min-h-dvh ${t.root}`}>
      <div className="max-w-3xl mx-auto px-6 pt-10">
        {/* ─── Hero (cover or theme gradient) ─────────────── */}
        {trip.cover_image_url ? (
          <div
            className="aspect-[16/10] w-full rounded-[28px] mb-6 bg-cover bg-center bg-cream-2"
            style={{ backgroundImage: `url(${escapeCss(trip.cover_image_url)})` }}
            aria-hidden="true"
          />
        ) : (
          <div className={`aspect-[16/10] w-full rounded-[28px] mb-6 ${t.cover}`}>
            <div className="h-full flex items-center justify-center px-6">
              <span className={`text-3xl sm:text-4xl text-center ${t.coverInk}`}>
                {trip.name}
              </span>
            </div>
          </div>
        )}

        {/* ─── Compact header ───────────────────────────── */}
        <p className={`text-[11px] mb-2 ${t.eyebrow}`}>
          {trip.status === "draft" ? "Draft" : "Live"} · {trip.theme ?? "no theme yet"}
        </p>
        <h1 className={`text-3xl sm:text-4xl leading-tight mb-2 ${t.display}`}>
          {trip.name}
        </h1>
        {(trip.destination || trip.start_date || trip.end_date) && (
          <p className={`mb-1 ${t.body}`}>
            {[trip.destination, formatDateRange(trip.start_date, trip.end_date)]
              .filter(Boolean)
              .join(" · ")}
          </p>
        )}

        {/* ─── Tab nav ──────────────────────────────────── */}
        <TabNav tripId={trip.id} />

        {/* Tab content */}
        <div className="pb-12">{children}</div>
      </div>
    </main>
  );
}

function formatDateRange(start: string | null, end: string | null): string {
  const fmt = (s: string) =>
    new Date(s + "T00:00:00").toLocaleDateString("en-US", {
      month: "short", day: "numeric",
    });
  if (start && end) {
    const y = new Date(start + "T00:00:00").getFullYear();
    return `${fmt(start)} → ${fmt(end)}, ${y}`;
  }
  if (start) return `From ${fmt(start)}`;
  if (end)   return `Until ${fmt(end)}`;
  return "Dates TBD";
}

function escapeCss(url: string): string {
  return url.replace(/[()'"\\]/g, "\\$&");
}
