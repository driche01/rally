// Phase A landing.
//
// If you're logged in, this is just a redirect to /trips — the
// real dashboard. Anon visitors see the marketing scaffold below
// (Phase A version; the full landing comes from the netlify site
// later).

import { redirect } from "next/navigation";
import Link from "next/link";
import AppHeader from "@/lib/brand/app-header";
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (data?.user) redirect("/trips");

  return (
    <main className="min-h-dvh flex flex-col p-6">
      <AppHeader />

      <div className="flex-1 flex items-center justify-center -mt-12">
        <div className="max-w-md text-center">
          <h1 className="font-display text-4xl sm:text-5xl leading-tight text-ink mb-4">
            Plan the trip. Skip the chaos.
          </h1>
          <Link
            href="/login"
            className="inline-flex h-12 px-6 items-center rounded-full bg-green text-cream font-bold hover:bg-green-2 active:scale-95 transition-transform"
          >
            Sign in →
          </Link>
        </div>
      </div>
    </main>
  );
}
