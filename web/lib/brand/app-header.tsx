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
import AccountMenu from "./account-menu";
import RespondentActions from "./respondent-actions";
import CreateTripButton from "./create-trip-button";

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
  // `usersId` (not profileId) is what /user/[id] expects — that route
  // gates on the Rally-side users table, looked up via
  // users.auth_user_id = auth.uid. Without this resolve step, the
  // "View profile" menu item 404s on the canonical link target.
  let usersId:     string | null = null;

  if (authUser) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("id, name, last_name, phone, avatar_url")
      .eq("id", authUser.id)
      .maybeSingle();
    if (profile) {
      avatarUrl = profile.avatar_url;
      displayName = profile.last_name
        ? `${profile.name} ${profile.last_name}`
        : profile.name;
      // Resolve users.id — first by auth_user_id (the FK Rally uses
      // for new accounts), then by phone (fallback for older accounts
      // where the linkage was never backfilled).
      const svc = createServiceClient();
      const byAuth = await svc
        .from("users").select("id").eq("auth_user_id", authUser.id).maybeSingle();
      usersId = byAuth.data?.id ?? null;
      if (!usersId && profile.phone) {
        const byPhone = await svc
          .from("users").select("id, auth_user_id").eq("phone", profile.phone).maybeSingle();
        usersId = byPhone.data?.id ?? null;
        // If we found a phone-keyed row but it isn't linked to this
        // auth user yet, backfill the FK so the lookup is fast next time.
        if (usersId && !byPhone.data?.auth_user_id) {
          await svc.from("users").update({ auth_user_id: authUser.id }).eq("id", usersId);
        }
      }
      // Lazy-create a users row for accounts that have never been
      // through any of the RPCs that create one (SMS session,
      // traveler-profile self-heal, RSVP). Without this, the
      // "View profile" menu item silently disappears for SSO users
      // who haven't yet RSVPed or accepted an invite.
      if (!usersId && profile.phone) {
        const { data: created } = await svc
          .from("users")
          .insert({
            phone:          profile.phone,
            auth_user_id:   authUser.id,
            display_name:   displayName,
            rally_account:  true,
          })
          .select("id")
          .single();
        usersId = created?.id ?? null;
      }
    }
  }

  // Respondent-only branch: cookie present but no auth session.
  // RespondentActions handles the click-to-promote flow; we just
  // need the first name for the chip label.
  let respondentName: string | null = null;
  if (!authUser) {
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get("rally_session_token")?.value ?? null;
    if (sessionToken) {
      // Newest respondent row for this session_token — same token can
      // be reused across re-RSVPs; pick the freshest first name.
      const svc = createServiceClient();
      const { data: respondent } = await svc
        .from("respondents")
        .select("first_name, name")
        .eq("session_token", sessionToken)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (respondent) {
        respondentName = respondent.first_name
          ?? (respondent.name ? respondent.name.split(" ")[0] : null);
      }
    }
  }

  return (
    <header className={`mb-6 flex items-center justify-between gap-3 ${className}`}>
      <RallyLogo size="md" />

      <div className="flex items-center gap-2">
        {authUser ? (
          <>
            {!hideNewTrip && (
              <CreateTripButton
                className="hidden sm:inline-flex h-9 px-3 items-center rounded-full bg-green text-cream text-sm font-bold hover:bg-green-2 active:scale-95 transition-transform"
              >
                + New trip
              </CreateTripButton>
            )}
            <AccountMenu
              usersId={usersId}
              displayName={displayName}
              avatarUrl={avatarUrl}
            />
          </>
        ) : respondentName ? (
          // Respondent-only: cookie present, no Supabase session yet.
          // RespondentActions handles the promote-from-session flow on
          // click — they go from cookie-only to fully Supabase-authed in
          // one round-trip (no SMS round-trip required, since RSVP
          // already proved phone-device association at alpha-grade).
          <RespondentActions
            name={respondentName}
            showNewTrip={!hideNewTrip}
          />
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
