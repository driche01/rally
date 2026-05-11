/**
 * /trips/[id] — trip detail / planner dashboard placeholder.
 *
 * Step 3 lands the minimum: trip name, description, share link.
 * The full planner roster + invite UI lands in Steps 6 + 7.
 */

import { notFound, redirect } from "next/navigation";
import { requireAuthUid } from "@/lib/auth";
import type { Trip } from "@shared/types";

export default async function TripPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const r = await requireAuthUid();
  if (!r.ok) redirect(`/login?next=/trips/${id}`);

  const { data, error } = await r.supabase
    .from("trips")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    return (
      <main className="min-h-dvh flex items-center justify-center p-6">
        <p className="text-orange">Couldn&apos;t load trip: {error.message}</p>
      </main>
    );
  }
  if (!data) notFound();

  const trip = data as Trip;
  const baseUrl =
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const inviteUrl = `${baseUrl}/invite/${trip.share_token}`;

  return (
    <main className="min-h-dvh">
      <div className="max-w-2xl mx-auto px-6 py-10">
        <p className="text-xs font-bold tracking-widest uppercase text-green mb-3">
          {trip.status === "draft" ? "Draft" : "Live"} ·{" "}
          {trip.theme ?? "no theme yet"}
        </p>
        <h1 className="font-display text-4xl leading-tight text-ink mb-3">
          {trip.name}
        </h1>
        {trip.destination && (
          <p className="text-ink/80 mb-2">{trip.destination}</p>
        )}
        {(trip.start_date || trip.end_date) && (
          <p className="text-muted mb-6">
            {trip.start_date ?? "TBD"} → {trip.end_date ?? "TBD"}
          </p>
        )}
        {trip.description && (
          <p className="text-ink mb-8 max-w-prose">{trip.description}</p>
        )}

        <section className="bg-card border border-line rounded-[18px] p-5 mb-6">
          <p className="text-xs uppercase tracking-widest text-muted font-semibold mb-2">
            Share link
          </p>
          <p className="text-ink font-mono text-sm break-all mb-3">
            {inviteUrl}
          </p>
          <p className="text-muted text-sm">
            Friends who hit this link can RSVP without logging in. The invite
            page itself lands in Step 4 — for now, this is just the URL the
            planner will share.
          </p>
        </section>

        <section className="bg-card border border-line rounded-[18px] p-5">
          <p className="text-xs uppercase tracking-widest text-muted font-semibold mb-2">
            What&apos;s next
          </p>
          <ul className="grid gap-2 text-sm text-ink">
            <li>Step 4 — invitation page</li>
            <li>Step 5 — RSVP flow + profile capture</li>
            <li>Step 6 — send invitations</li>
            <li>Step 7 — roster (host view)</li>
          </ul>
        </section>
      </div>
    </main>
  );
}
