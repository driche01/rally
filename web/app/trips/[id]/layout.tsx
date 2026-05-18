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
import SaveTripBanner from "./save-trip-banner";
import GenerationProvider from "@/lib/generation/provider";
import EffectOverlay from "@/lib/effects/effect-overlay";
import StylePicker from "./style-picker";
import AppHeader from "@/lib/brand/app-header";
import ScrollResetOnMount from "@/lib/scroll-reset";
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
    .select("id, name, destination, destination_address, destination_place_id, start_date, end_date, book_by_date, theme, effect, cover_image_url, status, share_token, created_by, cancelled_at")
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
  const trip = tripRow as Pick<Trip, "id" | "name" | "destination" | "destination_address" | "destination_place_id" | "start_date" | "end_date" | "book_by_date" | "theme" | "effect" | "cover_image_url" | "status" | "share_token" | "created_by" | "cancelled_at">;

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
      {/* Theme-specific display font — only ship the bytes for the
          font this theme actually uses. Next.js App Router hoists
          <link> elements into <head> automatically, so the font
          streams in the same response as the HTML — no FOUT flicker
          on first paint, no cost to themes that don't define one. */}
      {t.fontDisplay && (
        <link rel="stylesheet" href={t.fontDisplay.googleFontsUrl} />
      )}
      <ScrollResetOnMount />
      <EffectOverlay effect={trip.effect ?? null} />
      <StylePicker
        tripId={trip.id}
        canEdit={canEdit}
        currentTheme={trip.theme}
        currentEffect={trip.effect ?? null}
      />
      <GenerationProvider>
        <div className="max-w-7xl mx-auto px-6 pt-6 relative">
          <AppHeader />

          {/* Draft banner — sticky at the top of the trip page until
              the planner clicks Save. Only renders when status='draft'
              + canEdit + not cancelled (those gates live inside the
              component so this call site stays a one-liner). */}
          <SaveTripBanner
            tripId={trip.id}
            status={trip.status}
            cancelled={Boolean(trip.cancelled_at)}
            canEdit={canEdit}
          />


          {/* 2-column layout on lg+: cover sticks on the left,
              vertically centered in the viewport regardless of how
              much content the right column has. Below lg, stacks
              single-column with cover on top.

              Sticky-center pattern: the wrapper is `position:
              sticky; top: 0; height: 100dvh` so it occupies the
              full viewport height and stays pinned to the top as
              the user scrolls. Inside, `flex flex-col justify-
              center` keeps the cover (+ action row) visually
              centered. This works whether the right column is
              empty (Lodging before AI suggestions) or long
              (Overview with stats + roster + activity feed) — no
              more "translate-y-1/2 applied at natural position"
              issue that made the cover sit too high on short
              tabs. */}
          {/* Mobile-only: trip header (title + destination + dates +
              hosted-by) ABOVE the banner image. On lg+ this is
              suppressed and the header renders in the right column
              of the two-col grid below. Rendered twice rather than
              re-ordered via CSS so EditableCover stays alone in
              its sticky-center left column at lg+ without grid
              gymnastics. */}
          <div className="lg:hidden mb-4">
            <EditableTripHeader
              tripId={trip.id}
              canEdit={canEdit}
              initial={{
                name:                 trip.name,
                destination:          trip.destination,
                destination_address:  trip.destination_address,
                destination_place_id: trip.destination_place_id,
                start_date:           trip.start_date,
                end_date:             trip.end_date,
                book_by_date:         trip.book_by_date,
                theme:                trip.theme,
                status:               trip.status,
              }}
            />
          </div>

          <div className="lg:grid lg:grid-cols-[7fr_5fr] lg:gap-10">
            <div className="space-y-4 lg:space-y-0 lg:sticky lg:top-0 lg:h-[100dvh] lg:flex lg:flex-col lg:justify-center lg:gap-4 mb-6 lg:mb-0">
              <EditableCover
                tripId={trip.id}
                canEdit={canEdit}
                initial={{
                  name:            trip.name,
                  cover_image_url: trip.cover_image_url,
                  theme:           trip.theme,
                  start_date:      trip.start_date,
                  end_date:        trip.end_date,
                }}
              />
              {canEdit && (
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
              )}
            </div>

            <div>
              {/* Desktop-only copy of the same header; mobile sees
                  the duplicate-render at the top of the page. */}
              <div className="hidden lg:block">
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
              </div>

              <TabNav tripId={trip.id} />

              <div className="pb-12">{children}</div>
            </div>
          </div>
        </div>
      </GenerationProvider>
    </main>
  );
}
