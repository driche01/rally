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
import { EditableCover, EditableTripHeader } from "./editable-hero";
import TripActions from "./trip-actions";
import GenerationProvider from "@/lib/generation/provider";
import EffectOverlay from "@/lib/effects/effect-overlay";
import StylePicker from "./style-picker";
import RallyLogo from "@/lib/brand/logo";
import { getSiteUrl } from "@/lib/site-url";
import type { Respondent } from "@shared/types";

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
    .select("id, name, destination, start_date, end_date, book_by_date, theme, effect, cover_image_url, status, share_token, created_by, cancelled_at")
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
  const trip = tripRow as Pick<Trip, "id" | "name" | "destination" | "start_date" | "end_date" | "book_by_date" | "theme" | "effect" | "cover_image_url" | "status" | "share_token" | "created_by" | "cancelled_at">;

  // Host-or-cohost gate for edit affordances.
  let canEdit = trip.created_by === r.authUid;
  const svc = createServiceClient();
  if (!canEdit) {
    const { data: cohost } = await svc.from("trip_cohosts")
      .select("trip_id").eq("trip_id", id).eq("user_id", r.authUid).maybeSingle();
    canEdit = !!cohost;
  }

  // Hosts get the action row under the cover (Invite + Copy share +
  // Send blast + overflow). Load the respondents up here so the
  // blast composer has the segment counts on first paint.
  let respondents: Respondent[] = [];
  let inviteUrl = "";
  if (canEdit) {
    const { data: respRows } = await svc
      .from("respondents")
      .select("*")
      .eq("trip_id", id)
      .order("created_at", { ascending: true });
    respondents = (respRows ?? []) as Respondent[];
    const baseUrl = await getSiteUrl();
    inviteUrl = `${baseUrl}/invite/${trip.share_token}`;
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
        <div className="max-w-6xl mx-auto px-6 pt-6 relative">
          <header className="mb-6">
            <RallyLogo size="md" />
          </header>

          {/* 2-column layout on lg+: cover sticks on the left + is
              vertically centered in the viewport as the user scrolls;
              header+tabs+content scrolls on the right. Below lg,
              stacks single-column with cover on top (mobile-first
              fallback).

              Vertical-center sticky: the wrapper sticks at top:50vh
              and translates up by half its own height so the cover's
              midpoint always sits at viewport center.  `self-start`
              is load-bearing — without it CSS Grid stretches the
              item to fill the column height and `sticky` becomes a
              no-op. */}
          <div className="lg:grid lg:grid-cols-[5fr_7fr] lg:gap-10">
            <div className="lg:sticky lg:top-[50vh] lg:-translate-y-1/2 lg:self-start mb-6 lg:mb-0">
              <EditableCover
                tripId={trip.id}
                canEdit={canEdit}
                initial={{
                  name:            trip.name,
                  cover_image_url: trip.cover_image_url,
                  theme:           trip.theme,
                }}
              />
              {canEdit && (
                <div className="mt-4">
                  <TripActions
                    trip={{
                      id:           trip.id,
                      name:         trip.name,
                      theme:        trip.theme,
                      cancelled_at: trip.cancelled_at,
                    }}
                    respondents={respondents}
                    inviteUrl={inviteUrl}
                  />
                </div>
              )}
            </div>

            <div>
              <EditableTripHeader
                tripId={trip.id}
                canEdit={canEdit}
                initial={{
                  name:         trip.name,
                  destination:  trip.destination,
                  start_date:   trip.start_date,
                  end_date:     trip.end_date,
                  book_by_date: trip.book_by_date,
                  theme:        trip.theme,
                  status:       trip.status,
                }}
              />

              <TabNav tripId={trip.id} />

              <div className="pb-12">{children}</div>
            </div>
          </div>
        </div>
      </GenerationProvider>
    </main>
  );
}
