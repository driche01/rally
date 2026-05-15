/**
 * /login — phone OTP login (Option A from BUILD_QUESTIONS Q9).
 *
 * Reuses the existing `request-phone-login-otp` and
 * `verify-phone-login-otp` edge functions. The same flow the Expo
 * app uses; one identity per phone across web and mobile.
 *
 * Limitation: requires a pre-existing profiles row with phone +
 * email. Alpha cohort is whitelisted manually for v1.
 */

import LoginForm from "./login-form";
import RallyLogo from "@/lib/brand/logo";

export default function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; phone?: string }>;
}) {
  return (
    <main className="min-h-dvh flex flex-col items-center p-6">
      <header className="w-full max-w-sm mb-12 pt-6">
        <RallyLogo size="md" />
      </header>
      <div className="w-full max-w-sm flex-1 flex flex-col justify-center -mt-12">
        <h1 className="font-display text-3xl leading-tight text-ink text-center mb-2">
          Welcome back.
        </h1>
        <p className="text-muted text-center text-sm mb-8">
          Enter your phone, we&apos;ll text you a code.
        </p>
        <LoginFormWrapper searchParams={searchParams} />
      </div>
    </main>
  );
}

async function LoginFormWrapper({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; phone?: string }>;
}) {
  const sp = await searchParams;
  return <LoginForm next={sp.next ?? "/trips"} initialPhone={sp.phone ?? ""} />;
}
