/**
 * AppHeader — global top bar (logo left, identity + create-trip CTA
 * right). Server component so we can read the auth session + the
 * rally_session_token cookie without a client round-trip.
 *
 * Three identity states, in priority order:
 *
 *   1. Authed Rally user (Supabase auth session): show avatar / name
 *      → links to /user/[id]. Plus a "+ New trip" pill.
 *
 *   2. Respondent-only (rally_session_token cookie, no auth): show
 *      their first name + a small "create your own trip" CTA that
 *      drops them at /login?next=/trips/new with phone pre-filled.
 *
 *   3. Anonymous: show "Sign in" → /login.
 *
 * Pattern mirrors Partiful's top-right area: a small identity chip
 * with a primary CTA next to it. Kept dependency-light so it can
 * drop into every page header without prop drilling.
 */

import Link from "next/link";
import { cookies } from "next/headers";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import RallyLogo from "./logo";

interface AppHeaderProps {
  /** Optional className for the outer <header>. */
  className?: string;
  /** Hide the "New trip" CTA — useful on /trips/new itself. */
  hideNewTrip?: boolean;
}

export default async function AppHeader({
  className = "",
  hideNewTrip = false,
}: AppHeaderProps) {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  const authUser = authData?.user ?? null;

  // Resolve display + avatar for the authed branch.
  let displayName: string | null = null;
  let avatarUrl:   string | null = null;
  let profileId:   string | null = null;

  if (authUser) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("id, name, last_name, avatar_url")
      .eq("id", authUser.id)
      .maybeSingle();
    if (profile) {
      profileId = profile.id;
      avatarUrl = profile.avatar_url;
      displayName = profile.last_name
        ? `${profile.name} ${profile.last_name}`
        : profile.name;
    }
  }

  // Respondent-only branch: cookie present but no auth session.
  let respondentName: string | null = null;
  let respondentPhone: string | null = null;
  if (!authUser) {
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get("rally_session_token")?.value ?? null;
    if (sessionToken) {
      // Newest respondent row for this session_token — the same session
      // token is reused across re-RSVPs, but a planner who later re-
      // shares the link to themselves could land on a different one;
      // pick the most recent so the chip shows their freshest first
      // name.
      const svc = createServiceClient();
      const { data: respondent } = await svc
        .from("respondents")
        .select("first_name, name, phone")
        .eq("session_token", sessionToken)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (respondent) {
        respondentName = respondent.first_name
          ?? (respondent.name ? respondent.name.split(" ")[0] : null);
        respondentPhone = respondent.phone;
      }
    }
  }

  return (
    <header className={`mb-6 flex items-center justify-between gap-3 ${className}`}>
      <RallyLogo size="md" />

      <div className="flex items-center gap-2">
        {authUser && profileId ? (
          <>
            {!hideNewTrip && (
              <Link
                href="/trips/new"
                className="hidden sm:inline-flex h-9 px-3 items-center rounded-full bg-green text-cream text-sm font-bold hover:bg-green-2 active:scale-95 transition-transform"
              >
                + New trip
              </Link>
            )}
            <Link
              href={`/user/${profileId}`}
              aria-label="Your account"
              className="flex items-center gap-2 h-9 pl-1 pr-3 rounded-full bg-card border border-line hover:border-green text-sm text-ink active:scale-95 transition-transform"
            >
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={avatarUrl}
                  alt=""
                  className="h-7 w-7 rounded-full object-cover"
                />
              ) : (
                <span className="h-7 w-7 rounded-full bg-green-soft text-green font-bold text-xs flex items-center justify-center">
                  {(displayName ?? "R").charAt(0).toUpperCase()}
                </span>
              )}
              <span className="hidden sm:inline truncate max-w-[8rem]">
                {displayName ?? "Account"}
              </span>
            </Link>
          </>
        ) : respondentName ? (
          <>
            {!hideNewTrip && (
              <Link
                href={
                  respondentPhone
                    ? `/login?next=/trips/new&phone=${encodeURIComponent(respondentPhone)}`
                    : "/login?next=/trips/new"
                }
                className="hidden sm:inline-flex h-9 px-3 items-center rounded-full bg-green text-cream text-sm font-bold hover:bg-green-2 active:scale-95 transition-transform"
              >
                + New trip
              </Link>
            )}
            <span className="flex items-center gap-2 h-9 pl-1 pr-3 rounded-full bg-card border border-line text-sm text-ink">
              <span className="h-7 w-7 rounded-full bg-green-soft text-green font-bold text-xs flex items-center justify-center">
                {respondentName.charAt(0).toUpperCase()}
              </span>
              <span className="hidden sm:inline truncate max-w-[8rem]">
                {respondentName}
              </span>
            </span>
          </>
        ) : (
          <Link
            href="/login"
            className="h-9 px-4 inline-flex items-center rounded-full bg-card border border-line text-sm text-ink hover:border-green active:scale-95 transition-transform"
          >
            Sign in
          </Link>
        )}
      </div>
    </header>
  );
}
