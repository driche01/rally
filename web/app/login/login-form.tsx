"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { requestPhoneOtp, verifyPhoneOtp } from "@/lib/sb-functions";

type Stage = "phone" | "code";

export default function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const supabase = createClient();

  const [stage, setStage] = useState<Stage>("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function sendOtp(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const r = await requestPhoneOtp(phone);
      if (!r.ok) {
        setErr(prettyError(r.reason || r.error));
        return;
      }
      // The edge function returns ok=true even for unrecognized phones
      // (anti-enumeration was relaxed for the alpha — see function comment).
      // sent=false / registered=false means "no Rally account on this
      // number, don't wait for a code that isn't coming."
      if (r.sent === false || r.registered === false) {
        setErr(
          "No Rally account on that number yet. Ping the team to get whitelisted — Phase A is alpha-only.",
        );
        return;
      }
      setStage("code");
    } catch (e) {
      setErr("Couldn't reach Rally. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function submitOtp(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const v = await verifyPhoneOtp(phone, code);
      if (!v.ok || !v.token_hash || !v.email) {
        setErr(prettyError(v.reason || v.error));
        return;
      }
      // Exchange the magic-link token for a real session. The browser
      // client writes the session cookie that middleware + server
      // components will see on the next request.
      const { error: sessionErr } = await supabase.auth.verifyOtp({
        type: "magiclink",
        token_hash: v.token_hash,
      });
      if (sessionErr) {
        setErr(sessionErr.message);
        return;
      }
      router.replace(next);
      router.refresh();
    } catch {
      setErr("Couldn't reach Rally. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-card border border-line rounded-[18px] p-6 shadow-sm">
      {stage === "phone" ? (
        <form onSubmit={sendOtp} className="grid gap-4">
          <label className="grid gap-2">
            <span className="text-xs uppercase tracking-widest text-muted font-semibold">
              Phone
            </span>
            <input
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              required
              placeholder="(555) 123-4567"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="h-14 rounded-xl border border-line bg-cream-2/40 px-4 text-lg text-ink placeholder:text-muted focus:border-green focus:outline-none"
            />
          </label>
          {err && <p className="text-sm text-orange">{err}</p>}
          <button
            type="submit"
            disabled={busy || phone.trim().length < 7}
            className="h-14 rounded-full bg-green text-cream font-bold text-base disabled:opacity-50 disabled:cursor-not-allowed hover:bg-green-2 transition-colors"
          >
            {busy ? "Sending…" : "Text me a code →"}
          </button>
          <p className="text-xs text-muted text-center pt-1">
            Don&apos;t have an account yet? Ping the Rally team — we&apos;re
            whitelisting alpha testers manually.
          </p>
        </form>
      ) : (
        <form onSubmit={submitOtp} className="grid gap-4">
          <div className="text-sm text-muted">
            Sent a 6-digit code to{" "}
            <span className="text-ink font-semibold">{phone}</span>{" "}
            <button
              type="button"
              onClick={() => {
                setStage("phone");
                setCode("");
                setErr(null);
              }}
              className="text-green underline underline-offset-2"
            >
              edit
            </button>
          </div>
          <label className="grid gap-2">
            <span className="text-xs uppercase tracking-widest text-muted font-semibold">
              Code
            </span>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              maxLength={6}
              pattern="\d{6}"
              placeholder="123 456"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              className="h-14 rounded-xl border border-line bg-cream-2/40 px-4 text-lg tracking-[0.4em] font-mono text-ink placeholder:text-muted focus:border-green focus:outline-none"
            />
          </label>
          {err && <p className="text-sm text-orange">{err}</p>}
          <button
            type="submit"
            disabled={busy || code.length !== 6}
            className="h-14 rounded-full bg-green text-cream font-bold text-base disabled:opacity-50 disabled:cursor-not-allowed hover:bg-green-2 transition-colors"
          >
            {busy ? "Checking…" : "Sign in →"}
          </button>
        </form>
      )}
    </div>
  );
}

function prettyError(reason?: string): string {
  switch (reason) {
    case "invalid_code":
      return "That code didn't work. Try again or request a new one.";
    case "expired":
      return "Code expired. Request a fresh one.";
    case "too_many_attempts":
      return "Too many tries. Wait a minute and request a new code.";
    case "rate_limited":
      return "Slow down — too many requests. Try again in a few minutes.";
    case "invalid_phone":
      return "That doesn't look like a valid phone number.";
    case "no_account":
      return "No Rally account on that number yet. Ping the team to get whitelisted.";
    default:
      return "Something went wrong. Try again.";
  }
}
