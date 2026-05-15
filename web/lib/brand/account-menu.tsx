"use client";

/**
 * AccountMenu — top-right avatar dropdown for authed users.
 *
 * Drops out of <AppHeader>. Server-renders with the user's display
 * data passed in; client-renders the dropdown + the <SettingsModal>
 * island. Closes on outside-click, Esc, and route changes.
 *
 * Menu items:
 *   - View profile  → /user/[profileId]
 *   - Settings      → opens <SettingsModal>
 *   - Sign out      → supabase.auth.signOut() + redirect to /
 *
 * The trigger looks like the chip we used to render directly: small
 * avatar circle + first name on >sm.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import SettingsModal from "./settings-modal";

export interface AccountMenuProps {
  /** Rally-side users.id — the URL param /user/[id] expects. Null when
   * the profile hasn't been linked to a users row yet (rare; usually
   * means the account was created via Google SSO and never RSVP'd
   * anywhere). In that case we hide View profile from the menu. */
  usersId: string | null;
  displayName: string | null;
  avatarUrl:   string | null;
}

export default function AccountMenu({
  usersId, displayName, avatarUrl,
}: AccountMenuProps) {
  const router = useRouter();
  const [open, setOpen]         = useState(false);
  const [settingsOpen, setSet]  = useState(false);
  const [signingOut, setSigning] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on outside click / Esc.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function signOut() {
    setSigning(true);
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
    } finally {
      // Force a hard refresh so server components rebuild without the session cookie.
      router.replace("/");
      router.refresh();
    }
  }

  const initial = (displayName ?? "R").charAt(0).toUpperCase();

  return (
    <div className="relative" ref={rootRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Open account menu"
        className="flex items-center gap-2 h-9 pl-1 pr-3 rounded-full bg-card border border-line hover:border-green text-sm text-ink active:scale-95 transition-transform"
      >
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatarUrl} alt="" className="h-7 w-7 rounded-full object-cover" />
        ) : (
          <span className="h-7 w-7 rounded-full bg-green-soft text-green font-bold text-xs flex items-center justify-center">
            {initial}
          </span>
        )}
        <span className="hidden sm:inline truncate max-w-[8rem]">
          {displayName ?? "Account"}
        </span>
        <span aria-hidden="true" className="text-muted text-xs hidden sm:inline">▾</span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-2 min-w-[200px] bg-card border border-line rounded-2xl shadow-lg z-40 overflow-hidden"
        >
          {usersId && (
            <Link
              role="menuitem"
              href={`/user/${usersId}`}
              onClick={() => setOpen(false)}
              className="block px-4 py-2.5 text-sm text-ink hover:bg-green-soft/50"
            >
              View profile
            </Link>
          )}
          <button
            role="menuitem"
            onClick={() => { setOpen(false); setSet(true); }}
            className="w-full text-left px-4 py-2.5 text-sm text-ink hover:bg-green-soft/50"
          >
            Settings
          </button>
          <button
            role="menuitem"
            disabled={signingOut}
            onClick={signOut}
            className="w-full text-left px-4 py-2.5 text-sm text-orange hover:bg-orange/10 border-t border-line disabled:opacity-50"
          >
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
      )}

      {settingsOpen && (
        <SettingsModal onClose={() => setSet(false)} />
      )}
    </div>
  );
}
