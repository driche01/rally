/**
 * /trips/[id]/layout.tsx — shared chrome across every dashboard tab.
 *
 * Server-side: auth, trip fetch, theme propagation, host/cohost
 * gate. Hero markup is delegated to <EditableHero> (client), which
 * handles click-to-edit on cover / name / destination / dates /
 * book_by_date for planners + cohosts.
 */

import { notFound, redirect } from "next/navigation";
import { requireAuthUid } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { themeClass } from "@/lib/themes";
import type { Trip } from "@shared/types";
import TabNav from "./tabs";
import EditableHero from "./editable-hero";
import GenerationProvider from "@/lib/generation/provider";
import EffectOverlay from "@/lib/effects/effect-overlay";
import StylePicker from "./style-picker";

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
    .select("id, name, destination, start_date, end_date, book_by_date, theme, effect, cover_image_url, status, share_token, created_by")
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
  const trip = tripRow as Pick<Trip, "id" | "name" | "destination" | "start_date" | "end_date" | "book_by_date" | "theme" | "effect" | "cover_image_url" | "status" | "share_token" | "created_by">;

  // Host-or-cohost gate for edit affordances.
  let canEdit = trip.created_by === r.authUid;
  if (!canEdit) {
    const svc = createServiceClient();
    const { data: cohost } = await svc.from("trip_cohosts")
      .select("trip_id").eq("trip_id", id).eq("user_id", r.authUid).maybeSingle();
    canEdit = !!cohost;
  }

  const t = themeClass(trip.theme);

  return (
    <main className={`min-h-dvh ${t.root} relative`}>
      <EffectOverlay effect={trip.effect ?? null} />
      <StylePicker
        tripId={trip.id}
        canEdit={canEdit}
        currentTheme={trip.theme}
        currentEffect={trip.effect ?? null}
      />
      <GenerationProvider>
        <div className="max-w-3xl mx-auto px-6 pt-10 relative">
          <EditableHero
            tripId={trip.id}
            canEdit={canEdit}
            initial={{
              name:             trip.name,
              destination:      trip.destination,
              start_date:       trip.start_date,
              end_date:         trip.end_date,
              book_by_date:     trip.book_by_date,
              cover_image_url:  trip.cover_image_url,
              theme:            trip.theme,
              status:           trip.status,
            }}
          />

          <TabNav tripId={trip.id} />

          <div className="pb-12">{children}</div>
        </div>
      </GenerationProvider>
    </main>
  );
}
