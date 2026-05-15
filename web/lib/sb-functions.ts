/**
 * Thin client for the Rally Supabase edge functions we call from
 * the browser (Phase A: phone-OTP login). Keeps the URL + apikey
 * boilerplate in one place.
 *
 * Note: the existing edge functions set `verify_jwt = false` because
 * the sb_publishable_* key isn't JWT-format. They still require the
 * `apikey` header — that's the Supabase gateway's bouncer.
 */

function endpoint(name: string): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
  return `${base.replace(/\/$/, "")}/functions/v1/${name}`;
}

function publishableKey(): string {
  const k = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!k) throw new Error("Missing NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  return k;
}

async function call<T>(name: string, body: unknown, jwt?: string): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    apikey: publishableKey(),
  };
  if (jwt) headers.Authorization = `Bearer ${jwt}`;
  const res = await fetch(endpoint(name), {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  // We return both 2xx and 4xx as JSON — the edge functions encode
  // their own {ok, reason} envelope, and the caller decides what
  // counts as an error.
  return (await res.json()) as T;
}

export interface OtpRequestResult {
  ok: boolean;
  sent?: boolean;        // false when phone is unrecognized (see edge function comment)
  registered?: boolean;  // explicit alpha-whitelist signal
  reason?: string;
  error?: string;
}

export interface OtpVerifyResult {
  ok: boolean;
  token_hash?: string;
  email?: string;
  reason?: string;
  error?: string;
}

export function requestPhoneOtp(phone: string) {
  return call<OtpRequestResult>("request-phone-login-otp", { phone });
}

export function verifyPhoneOtp(phone: string, code: string) {
  return call<OtpVerifyResult>("verify-phone-login-otp", { phone, code });
}

// ─── Authenticated edge functions (require the user JWT) ──────────

export interface PhoneChangeRequestResult {
  ok: boolean;
  sent?: boolean;
  reason?: string;
  error?: string;
}
export interface PhoneChangeVerifyResult {
  ok: boolean;
  reason?: string;
  error?: string;
}
export interface DeleteAccountResult {
  ok: boolean;
  reason?: string;
  error?: string;
}

export function requestPhoneChangeOtp(phone: string, jwt: string) {
  return call<PhoneChangeRequestResult>("request-phone-change-otp", { phone }, jwt);
}

export function verifyPhoneChangeOtp(phone: string, code: string, jwt: string) {
  return call<PhoneChangeVerifyResult>("verify-phone-change-otp", { phone, code }, jwt);
}

export function deleteAccount(jwt: string) {
  return call<DeleteAccountResult>("delete-account", {}, jwt);
}
