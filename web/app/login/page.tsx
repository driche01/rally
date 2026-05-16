/**
 * /login — phone OTP login (Option A from BUILD_QUESTIONS Q9).
 *
 * Reuses the existing `request-phone-login-otp` and
 * `verify-phone-login-otp` edge functions. The same flow the Expo
 * app uses; one identity per phone across web and mobile.
 *
 * Limitation: requires a pre-existing profiles row with phone +
 * email. Alpha cohort is whitelisted manually for v1.
 *
 * Header policy (intentional):
 *   The sign-in surface MUST NOT expose any top-right access
 *   points — no Sign-in link, no "+ New trip" pill, no profile chip.
 *   That means this page renders <RallyLogo> directly, NEVER
 *   <AppHeader>. The logo is centered above the form; the rest of
 *   the top strip stays empty so the form is the only call to
 *   action.
 *
 *   Authed users are redirected to /trips so they never land here
 *   in a state that could surface those affordances.
 */

import { redirect } from "next/navigation";
import LoginForm from "./login-form";
import RallyLogo from "@/lib/brand/logo";
import { createClient } from "@/lib/supabase/server";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; phone?: string }>;
}) {
  // Authed users skip the form entirely — bounce to /trips. If the
  // caller asked for a specific destination via ?next=…, honor it.
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const sp = await searchParams;
  if (data?.user) redirect(sp.next ?? "/trips");

  return (
    <main className="min-h-dvh flex flex-col items-center p-6">
      <header className="w-full max-w-sm mb-12 pt-6">
        <RallyLogo size="md" asLink={false} />
      </header>
      <div className="w-full max-w-sm flex-1 flex flex-col justify-center -mt-12">
        <h1 className="font-display text-3xl leading-tight text-ink text-center mb-2">
          Welcome back.
        </h1>
        <p className="text-muted text-center text-sm mb-8">
          Enter your phone, we&apos;ll text you a code.
        </p>
        <LoginForm next={sp.next ?? "/trips"} initialPhone={sp.phone ?? ""} />
      </div>
    </main>
  );
}
