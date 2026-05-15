"use client";

/**
 * Locked-profile state — rendered when the viewer doesn't share a
 * trip with the target user (per profile-visibility.ts). Shows only
 * first name + initial-letter avatar + an explanation + a back nav.
 *
 * Per Q29 graceful-UX directive: NOT a 404. The privacy-purist case
 * for 404 (don't leak existence) is weak here because user IDs are
 * uuids — not enumerable, only reachable via intentional sharing.
 * Friendly locked state wins.
 */

import { useRouter } from "next/navigation";
import RallyLogo from "@/lib/brand/logo";

export default function ProfileLocked({
  firstName,
  tripCount,
}: {
  firstName: string;
  tripCount: number | null;
}) {
  const router = useRouter();

  function goBack() {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
    } else {
      router.push("/");
    }
  }

  const initial = (firstName.charAt(0) || "?").toUpperCase();

  return (
    <main className="min-h-dvh bg-cream flex flex-col px-6 py-6">
      <header className="mb-8">
        <RallyLogo size="md" />
      </header>
      <div className="flex-1 flex items-center justify-center -mt-12">
      <div className="bg-card border border-line rounded-[28px] p-8 sm:p-10 max-w-md w-full text-center">
        {/* Generic initial-letter avatar — NEVER their real avatar,
            even blurred. That would still be content leakage. */}
        <div
          aria-hidden
          className="mx-auto mb-5 h-24 w-24 rounded-full bg-green-soft text-green flex items-center justify-center font-display text-4xl font-bold border-2 border-green/30"
        >
          {initial}
        </div>

        <h1 className="font-display text-3xl text-ink leading-tight mb-2">
          {firstName}
        </h1>

        {tripCount != null && tripCount > 0 && (
          <p className="text-sm text-muted mb-5">
            {tripCount} trip{tripCount === 1 ? "" : "s"} on Rally
          </p>
        )}

        <p className="text-base text-ink leading-relaxed mb-8">
          You can see {firstName}&rsquo;s profile once you&rsquo;ve shared a trip together. Invite them on your next one — or wait for an overlap to unlock.
        </p>

        <button
          onClick={goBack}
          className="h-12 px-6 rounded-full bg-green text-cream font-bold hover:bg-green-2"
        >
          ← Back
        </button>
      </div>
      </div>
    </main>
  );
}
