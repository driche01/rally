/**
 * /trips/new — planner trip creation form.
 *
 * Server component that gates on auth, then renders the client form.
 * Build guide §6 Step 3.
 */

import { redirect } from "next/navigation";
import { requireAuthUid } from "@/lib/auth";
import TripForm from "./trip-form";

export default async function NewTripPage() {
  const r = await requireAuthUid();
  if (!r.ok) redirect("/login?next=/trips/new");

  return (
    <main className="min-h-dvh">
      <div className="max-w-2xl mx-auto px-6 py-10">
        <p className="text-xs font-bold tracking-widest uppercase text-green mb-3">
          Rally · New trip
        </p>
        <h1 className="font-display text-4xl leading-tight text-ink mb-2">
          Set the trip.
        </h1>
        <p className="text-muted mb-8">
          Just the load-bearing parts. You can edit anything later.
        </p>
        <TripForm />
      </div>
    </main>
  );
}
