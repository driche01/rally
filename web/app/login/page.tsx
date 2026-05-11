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

export default function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  return (
    <main className="min-h-dvh flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <p className="text-xs font-bold tracking-widest uppercase text-green mb-3 text-center">
          Rally
        </p>
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
  searchParams: Promise<{ next?: string }>;
}) {
  const sp = await searchParams;
  return <LoginForm next={sp.next ?? "/trips/new"} />;
}
