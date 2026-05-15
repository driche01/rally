"use client";

/**
 * SettingsModal — center-of-screen modal with a left sidebar of
 * tabs. Modeled after Partiful's Profile Settings:
 *
 *   Sidebar: Account · Calendar Sync
 *   Account: change phone (OTP) · sign out · delete account (gated
 *            by a typed confirmation)
 *   Calendar Sync: Gcal copy-link card + iCal webcal:// card +
 *                  toggles for which RSVP statuses to include.
 *
 * Loads /api/account on mount; saves calendar toggles via PATCH on
 * change. Phone-change + delete go through existing Supabase edge
 * functions (request-phone-change-otp / verify-phone-change-otp /
 * delete-account) using the user's JWT.
 *
 * Modal lifecycle is owned by AccountMenu. Closes on backdrop click
 * and Esc — except when the user is mid-flow on a destructive action.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  requestPhoneChangeOtp, verifyPhoneChangeOtp, deleteAccount,
} from "@/lib/sb-functions";

type Tab = "account" | "calendar";

interface AccountData {
  id: string;
  name: string;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  avatar_url: string | null;
  calendar_token: string;
  calendar_include_going:   boolean;
  calendar_include_maybe:   boolean;
  calendar_include_invited: boolean;
}

export default function SettingsModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab]       = useState<Tab>("account");
  const [data, setData]     = useState<AccountData | null>(null);
  const [loadErr, setErr]   = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/account", { cache: "no-store" });
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok || !body.ok) {
          setErr(body?.error?.code || "Couldn't load settings.");
          return;
        }
        setData(body.data as AccountData);
      } catch {
        if (!cancelled) setErr("Couldn't reach Rally.");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Esc-to-close.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    // Lock body scroll while open.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-6"
      role="dialog" aria-modal="true" aria-labelledby="settings-title"
      onClick={onClose}
    >
      <div
        className="bg-cream w-full sm:max-w-4xl sm:rounded-[28px] rounded-t-[28px] max-h-[92dvh] overflow-hidden shadow-lg flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-line flex items-center justify-between">
          <button
            onClick={onClose}
            aria-label="Close"
            className="h-9 w-9 rounded-full hover:bg-line/40 text-ink text-xl leading-none -ml-2"
          >
            ×
          </button>
          <h2 id="settings-title" className="font-display text-xl text-ink">
            Profile Settings
          </h2>
          <span className="w-9" /> {/* spacer for centering */}
        </div>

        {/* Body — sidebar + tab panel */}
        <div className="flex-1 overflow-hidden flex flex-col sm:flex-row">
          {/* Sidebar (becomes a horizontal pill row on small screens) */}
          <nav className="border-b sm:border-b-0 sm:border-r border-line bg-cream-2/40 sm:w-56 sm:flex-shrink-0 p-3 flex sm:flex-col gap-1 overflow-x-auto">
            <SidebarItem
              icon="⚙"
              label="Account"
              active={tab === "account"}
              onClick={() => setTab("account")}
            />
            <SidebarItem
              icon="📅"
              label="Calendar Sync"
              active={tab === "calendar"}
              onClick={() => setTab("calendar")}
            />
          </nav>

          {/* Tab panel */}
          <div className="flex-1 overflow-y-auto p-6">
            {loadErr ? (
              <p className="text-orange text-sm">{loadErr}</p>
            ) : !data ? (
              <p className="text-muted text-sm">Loading…</p>
            ) : tab === "account" ? (
              <AccountTab data={data} onClose={onClose} onUpdated={setData} />
            ) : (
              <CalendarTab data={data} onUpdated={setData} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SidebarItem({
  icon, label, active, onClick,
}: { icon: string; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={
        "flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold whitespace-nowrap " +
        (active
          ? "bg-card text-ink border border-line shadow-sm"
          : "text-muted hover:text-ink hover:bg-card/60")
      }
    >
      <span aria-hidden="true">{icon}</span>
      {label}
    </button>
  );
}

// ─── Account tab ────────────────────────────────────────────────

function AccountTab({
  data, onClose, onUpdated,
}: {
  data: AccountData;
  onClose: () => void;
  onUpdated: (next: AccountData) => void;
}) {
  const router = useRouter();
  const [view, setView] = useState<"home" | "phone" | "delete">("home");

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    onClose();
    router.replace("/");
    router.refresh();
  }

  if (view === "phone") {
    return (
      <PhoneChangeFlow
        currentPhone={data.phone}
        onBack={() => setView("home")}
        onSaved={(phone) => {
          onUpdated({ ...data, phone });
          setView("home");
        }}
      />
    );
  }
  if (view === "delete") {
    return (
      <DeleteAccountFlow
        displayName={data.name}
        onBack={() => setView("home")}
        onDeleted={() => {
          onClose();
          router.replace("/");
          router.refresh();
        }}
      />
    );
  }

  return (
    <div>
      <h3 className="font-display text-2xl text-ink mb-5">Account Settings</h3>

      <button
        onClick={() => setView("phone")}
        className="w-full flex items-center gap-3 bg-card border border-line rounded-2xl px-4 py-3.5 text-left hover:border-green active:scale-[0.99] transition mb-3"
      >
        <span className="h-9 w-9 rounded-full bg-green-soft text-green flex items-center justify-center text-base" aria-hidden="true">📞</span>
        <span className="flex-1 min-w-0">
          <span className="block font-semibold text-ink">Change phone number</span>
          <span className="block text-sm text-muted truncate">
            {data.phone ?? "No phone on file"}
          </span>
        </span>
        <span className="text-muted text-lg" aria-hidden="true">›</span>
      </button>

      <button
        onClick={signOut}
        className="w-full flex items-center gap-3 bg-card border border-line rounded-2xl px-4 py-3.5 text-left hover:border-green active:scale-[0.99] transition mb-3"
      >
        <span className="h-9 w-9 rounded-full bg-card border border-line text-ink flex items-center justify-center text-base" aria-hidden="true">↪</span>
        <span className="flex-1 font-semibold text-ink">Sign out</span>
      </button>

      <button
        onClick={() => setView("delete")}
        className="w-full flex items-center gap-3 bg-card border border-line rounded-2xl px-4 py-3.5 text-left hover:border-orange active:scale-[0.99] transition"
      >
        <span className="h-9 w-9 rounded-full bg-orange/10 text-orange flex items-center justify-center text-base" aria-hidden="true">🗑</span>
        <span className="flex-1 font-semibold text-orange">Delete account</span>
        <span className="text-orange/70 text-lg" aria-hidden="true">›</span>
      </button>
    </div>
  );
}

function PhoneChangeFlow({
  currentPhone, onBack, onSaved,
}: {
  currentPhone: string | null;
  onBack: () => void;
  onSaved: (newPhone: string) => void;
}) {
  const [stage, setStage] = useState<"input" | "code">("input");
  const [phone, setPhone] = useState("");
  const [code, setCode]   = useState("");
  const [busy, setBusy]   = useState(false);
  const [err, setErr]     = useState<string | null>(null);

  async function getJwt(): Promise<string | null> {
    const supabase = createClient();
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  }

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const jwt = await getJwt();
      if (!jwt) { setErr("Sign-in expired. Please reload."); return; }
      const r = await requestPhoneChangeOtp(phone.trim(), jwt);
      if (!r.ok) {
        setErr(prettyReason(r.reason || r.error));
        return;
      }
      setStage("code");
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const jwt = await getJwt();
      if (!jwt) { setErr("Sign-in expired. Please reload."); return; }
      const r = await verifyPhoneChangeOtp(phone.trim(), code, jwt);
      if (!r.ok) {
        setErr(prettyReason(r.reason || r.error));
        return;
      }
      onSaved(phone.trim());
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        onClick={onBack}
        className="text-xs text-muted uppercase tracking-widest font-semibold mb-2 hover:text-ink"
      >
        ← Back
      </button>
      <h3 className="font-display text-2xl text-ink mb-1">Change phone number</h3>
      <p className="text-muted text-sm mb-5">
        On file: <span className="text-ink font-semibold">{currentPhone ?? "—"}</span>
      </p>

      {stage === "input" ? (
        <form onSubmit={sendCode} className="grid gap-4">
          <label className="grid gap-2">
            <span className="text-xs uppercase tracking-widest text-muted font-semibold">New phone</span>
            <input
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="(555) 123-4567"
              className="h-12 rounded-xl border border-line bg-card px-4 text-ink placeholder:text-muted focus:border-green focus:outline-none"
            />
          </label>
          {err && <p className="text-orange text-sm">{err}</p>}
          <button
            type="submit"
            disabled={busy || !phone.trim()}
            className="h-12 rounded-full bg-green text-cream font-bold disabled:opacity-50 hover:bg-green-2"
          >
            {busy ? "Sending…" : "Text me a code →"}
          </button>
        </form>
      ) : (
        <form onSubmit={verify} className="grid gap-4">
          <p className="text-sm text-muted">
            Sent a 6-digit code to{" "}
            <span className="text-ink font-semibold">{phone}</span>.{" "}
            <button
              type="button"
              onClick={() => { setStage("input"); setCode(""); setErr(null); }}
              className="text-green underline underline-offset-2"
            >
              edit
            </button>
          </p>
          <label className="grid gap-2">
            <span className="text-xs uppercase tracking-widest text-muted font-semibold">Code</span>
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
              className="h-12 rounded-xl border border-line bg-card px-4 text-ink placeholder:text-muted focus:border-green focus:outline-none font-mono tracking-[0.4em] text-lg"
            />
          </label>
          {err && <p className="text-orange text-sm">{err}</p>}
          <button
            type="submit"
            disabled={busy || code.length !== 6}
            className="h-12 rounded-full bg-green text-cream font-bold disabled:opacity-50 hover:bg-green-2"
          >
            {busy ? "Saving…" : "Save new phone"}
          </button>
        </form>
      )}
    </div>
  );
}

function DeleteAccountFlow({
  displayName, onBack, onDeleted,
}: { displayName: string; onBack: () => void; onDeleted: () => void }) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Match-against-name guard avoids "fat-fingered the wrong tab"
  // accidents. Case-insensitive, trimmed.
  const confirmTarget = (displayName || "delete").trim().toLowerCase();
  const canSubmit = typed.trim().toLowerCase() === confirmTarget;

  async function doDelete() {
    setBusy(true);
    setErr(null);
    try {
      const supabase = createClient();
      const { data } = await supabase.auth.getSession();
      const jwt = data.session?.access_token;
      if (!jwt) { setErr("Sign-in expired. Please reload."); return; }
      const r = await deleteAccount(jwt);
      if (!r.ok) {
        setErr(prettyReason(r.reason || r.error));
        return;
      }
      // Clear the session client-side before redirecting; the auth
      // user is already gone server-side.
      await supabase.auth.signOut().catch(() => {});
      onDeleted();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        onClick={onBack}
        className="text-xs text-muted uppercase tracking-widest font-semibold mb-2 hover:text-ink"
      >
        ← Back
      </button>
      <h3 className="font-display text-2xl text-ink mb-2">Delete account</h3>
      <div className="bg-orange/10 border border-orange/40 rounded-2xl p-4 mb-5">
        <p className="text-sm text-ink mb-1 font-semibold">
          This can&apos;t be undone.
        </p>
        <p className="text-sm text-ink/80">
          Trips you&apos;re hosting will be deleted. Your RSVPs on other
          people&apos;s trips, your profile, and your Rally account will
          be wiped from our database.
        </p>
      </div>
      <label className="grid gap-2 mb-5">
        <span className="text-xs uppercase tracking-widest text-muted font-semibold">
          Type <span className="text-ink font-bold">{displayName || "delete"}</span> to confirm
        </span>
        <input
          type="text"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          className="h-12 rounded-xl border border-line bg-card px-4 text-ink placeholder:text-muted focus:border-orange focus:outline-none"
        />
      </label>
      {err && <p className="text-orange text-sm mb-3">{err}</p>}
      <div className="flex gap-2">
        <button
          onClick={onBack}
          disabled={busy}
          className="flex-1 h-12 rounded-full bg-card text-ink border border-line hover:border-green font-semibold disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          onClick={doDelete}
          disabled={!canSubmit || busy}
          className="flex-1 h-12 rounded-full bg-orange text-cream font-bold hover:bg-orange/90 disabled:opacity-50"
        >
          {busy ? "Deleting…" : "Delete my account"}
        </button>
      </div>
    </div>
  );
}

// ─── Calendar Sync tab ──────────────────────────────────────────

function CalendarTab({
  data, onUpdated,
}: {
  data: AccountData;
  onUpdated: (next: AccountData) => void;
}) {
  const [copied, setCopied] = useState(false);

  // Build the user's calendar URLs once on mount. We assume the
  // browser's origin is where Rally is hosted; that matches
  // production + dev.
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const httpsUrl  = `${origin}/api/calendar/${data.calendar_token}.ics`;
  const webcalUrl = httpsUrl.replace(/^https?:/, "webcal:");
  // Google Calendar's "add by URL" flow doesn't accept a deep link
  // for arbitrary feeds, so we hand the user the URL + instructions.
  // Apple opens webcal:// natively → Calendar.app.

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(httpsUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy this link:", httpsUrl);
    }
  }

  async function toggle(field: keyof Pick<AccountData,
    "calendar_include_going" | "calendar_include_maybe" | "calendar_include_invited"
  >, next: boolean) {
    // Optimistic.
    const prev = { ...data };
    onUpdated({ ...data, [field]: next });
    try {
      const res = await fetch("/api/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: next }),
      });
      if (!res.ok) {
        onUpdated(prev);
      }
    } catch {
      onUpdated(prev);
    }
  }

  return (
    <div>
      <h3 className="font-display text-2xl text-ink mb-1">Calendar Sync</h3>
      <p className="text-muted text-sm mb-5">
        Subscribe to a live feed of your Rally trips. Updates roll in
        whenever your calendar refreshes.
      </p>

      <div className="grid grid-cols-2 gap-3 mb-6">
        {/* Google */}
        <button
          onClick={copyLink}
          className="bg-card border border-line rounded-2xl p-4 hover:border-green active:scale-[0.99] transition text-left"
        >
          <div className="h-10 w-10 rounded-lg bg-green-soft text-green flex items-center justify-center text-xl mb-2" aria-hidden="true">📅</div>
          <p className="font-semibold text-ink">Use Gcal</p>
          <p className="text-xs text-muted">
            {copied ? "Link copied ✓" : "Copy link"}
          </p>
        </button>
        {/* iCal */}
        <a
          href={webcalUrl}
          className="bg-card border border-line rounded-2xl p-4 hover:border-green active:scale-[0.99] transition block"
        >
          <div className="h-10 w-10 rounded-lg bg-orange/10 text-orange flex items-center justify-center text-xl mb-2" aria-hidden="true">🗓</div>
          <p className="font-semibold text-ink">Use iCal</p>
          <p className="text-xs text-muted">Open in Apple Calendar</p>
        </a>
      </div>

      <details className="mb-6 text-sm">
        <summary className="cursor-pointer text-muted hover:text-ink select-none">
          How do I add this to Google Calendar?
        </summary>
        <ol className="mt-2 list-decimal pl-5 text-muted space-y-1">
          <li>Copy the link above.</li>
          <li>Open Google Calendar → &ldquo;Other calendars&rdquo; → &ldquo;From URL&rdquo;.</li>
          <li>Paste and click Add calendar. It&apos;ll appear in a few minutes.</li>
        </ol>
      </details>

      <h4 className="font-display text-lg text-ink mb-1">
        Manage Synced Calendar
      </h4>
      <p className="text-muted text-xs mb-3">
        Trips you&apos;re hosting are always included.
      </p>

      <div className="bg-card border border-line rounded-2xl overflow-hidden mb-2">
        <ToggleRow
          icon="🎉"
          label="Going events"
          on={data.calendar_include_going}
          onChange={(v) => toggle("calendar_include_going", v)}
        />
        <ToggleRow
          icon="🤔"
          label="Maybe events"
          on={data.calendar_include_maybe}
          onChange={(v) => toggle("calendar_include_maybe", v)}
        />
        <ToggleRow
          icon="💌"
          label="Invited events"
          on={data.calendar_include_invited}
          onChange={(v) => toggle("calendar_include_invited", v)}
        />
      </div>
      <p className="text-xs text-muted">Preferences are saved automatically.</p>
    </div>
  );
}

function ToggleRow({
  icon, label, on, onChange,
}: { icon: string; label: string; on: boolean; onChange: (v: boolean) => void }) {
  // Visual notes:
  //   - Track is taller (h-7 = 28px) so the 22px knob has breathing room.
  //   - Knob uses bg-cream + a real border so off-state is legible
  //     against the bg-line (cream-toned) off-track — pure cream-on-
  //     cream was the old bug.
  //   - Position via inline `left` instead of translate-x-* utilities;
  //     Tailwind v4's arbitrary translate classes have purge edge cases
  //     in dev that left the knob stuck on one side.
  //   - `.no-press` class opts the button out of the global
  //     active:scale-0.97 + bg-green hover-lift in globals.css — the
  //     track shouldn't shrink mid-toggle.
  return (
    <label className="flex items-center gap-3 px-4 py-3.5 border-b border-line last:border-b-0 cursor-pointer">
      <span className="text-lg" aria-hidden="true">{icon}</span>
      <span className="flex-1 font-semibold text-ink">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        onClick={() => onChange(!on)}
        className={
          "no-press relative inline-block h-7 w-12 rounded-full transition-colors flex-shrink-0 " +
          (on ? "bg-green" : "bg-line border border-muted/30")
        }
        style={{ transform: "none" }}
      >
        <span
          aria-hidden="true"
          className="absolute top-1/2 -translate-y-1/2 h-5 w-5 rounded-full bg-cream shadow-md border border-ink/10 transition-[left] duration-150"
          style={{ left: on ? "calc(100% - 22px)" : "2px" }}
        />
      </button>
    </label>
  );
}

// ─── Helpers ───────────────────────────────────────────────────

function prettyReason(reason?: string): string {
  switch (reason) {
    case "invalid_code":        return "That code didn't work. Try again.";
    case "expired":             return "Code expired. Request a fresh one.";
    case "too_many_attempts":   return "Too many tries. Wait a bit, then try again.";
    case "rate_limited":        return "Slow down — too many requests. Try again in a few minutes.";
    case "invalid_phone":       return "That doesn't look like a valid phone number.";
    case "phone_in_use":        return "That phone is already on another Rally account.";
    case "invalid_auth":        return "Sign-in expired. Please reload.";
    case "missing_auth":        return "Sign-in expired. Please reload.";
    default:                    return "Something went wrong. Try again.";
  }
}
