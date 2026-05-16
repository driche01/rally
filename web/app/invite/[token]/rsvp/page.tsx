/**
 * /invite/[token]/rsvp — RSVP + profile capture flow.
 *
 * Server component shell: validates the token + choice, renders
 * the client RsvpFlow that owns the staged interaction.
 */

import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import RsvpFlow from "./rsvp-flow";
import type { Trip, RsvpStatus } from "@shared/types";

const VALID_CHOICES: ReadonlySet<RsvpStatus> = new Set([
  "going", "maybe", "cant_go",
]);

export default async function RsvpPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ choice?: string }>;
}) {
  const { token } = await params;
  const sp = await searchParams;
  const choice = sp.choice as RsvpStatus | undefined;

  if (!choice || !VALID_CHOICES.has(choice)) {
    redirect(`/invite/${token}`);
  }

  const anon = await createClient();
  const { data: tripRow } = await anon
    .from("trips")
    .select("id, name")
    .eq("share_token", token)
    .maybeSingle();
  if (!tripRow) notFound();
  const trip = tripRow as Pick<Trip, "id" | "name">;

  return (
    <RsvpFlow
      shareToken={token}
      choice={choice}
      tripName={trip.name}
    />
  );
}
