/**
 * /user/[id] — persistent profile page.
 *
 * Alpha+ Sprint 3. Visible to anyone who has shared a `respondents`
 * row on the same trip with the target user, ever (past or current,
 * regardless of RSVP outcome). Q29 + Q29 graceful-locked-UX.
 *
 * Renders:
 *   • Name + avatar (or initial-fallback)
 *   • Trip count + mutuals count
 *   • Going-trip history (past + upcoming), grouped by status
 *   • Travel profile summary (vibes, home airport, budget, dietary)
 *
 * Server-rendered. RLS is loose-ish on the underlying tables (the
 * profile-visibility helper is the real gate); we lift to the
 * service-role client after passing the gate.
 */

import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { requireAuthUid } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { canViewUserProfile } from "@/lib/profile-visibility";
import ProfileLocked from "./profile-locked";

export default async function UserProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: targetUserId } = await params;

  const r = await requireAuthUid();
  if (!r.ok) redirect(`/login?next=/user/${targetUserId}`);

  const svc = createServiceClient();

  // 1. Resolve viewer's users.id (via auth_user_id).
  const { data: viewerRow } = await svc
    .from("users")
    .select("id")
    .eq("auth_user_id", r.authUid)
    .maybeSingle();
  const viewerUserId = viewerRow?.id as string | undefined;
  if (!viewerUserId) {
    // The viewer is authenticated but has no users row — they're
    // someone who logged in but never RSVPed anywhere. They can't
    // view profiles (no possible shared respondents row).
    return <ProfileLocked firstName="this user" tripCount={null} />;
  }

  // 2. Resolve target user row (must exist).
  const { data: targetRow } = await svc
    .from("users")
    .select("id, phone, display_name, trip_count")
    .eq("id", targetUserId)
    .maybeSingle();
  if (!targetRow) notFound();
  const target = targetRow as {
    id: string;
    phone: string | null;
    display_name: string | null;
    trip_count: number | null;
  };

  // 3. Visibility check.
  const canView = await canViewUserProfile(svc, viewerUserId, targetUserId);

  // 4. Pick a display name. Priority order:
  //    users.display_name → most recent respondents.name → "this user"
  let displayName = target.display_name?.trim() || null;
  if (!displayName) {
    const { data: recentResp } = await svc
      .from("respondents")
      .select("name, created_at")
      .eq("user_id", targetUserId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    displayName = recentResp?.name ?? null;
  }
  const safeName = displayName ?? "this user";
  const firstName = safeName.split(/\s+/)[0] ?? safeName;

  if (!canView) {
    return <ProfileLocked firstName={firstName} tripCount={target.trip_count} />;
  }

  // 5. Pull trip history (going only, both past + upcoming, excluding
  // cancelled). Joins trips for date + name + destination.
  const { data: historyRows } = await svc
    .from("respondents")
    .select(`
      id, rsvp_status,
      trip:trips ( id, name, destination, start_date, end_date, theme, cancelled_at, cover_image_url )
    `)
    .eq("user_id", targetUserId)
    .in("rsvp_status", ["going"])
    .order("created_at", { ascending: false });

  interface TripRowShape {
    id: string;
    name: string;
    destination: string | null;
    start_date: string | null;
    end_date: string | null;
    theme: string | null;
    cancelled_at: string | null;
    cover_image_url: string | null;
  }
  type HistoryEntry = { id: string; trip: TripRowShape };
  const allHistory = (historyRows ?? [])
    .map((h) => {
      // PostgREST returns the nested trip as either a single object
      // (when the FK is one-to-one and the relationship name resolves
      // cleanly) or as an array (one-to-many style). Normalize.
      const tripField = (h as { trip: unknown }).trip;
      const tripRow = Array.isArray(tripField) ? (tripField[0] ?? null) : tripField;
      return { id: h.id as string, trip: tripRow as TripRowShape | null };
    })
    .filter((h): h is HistoryEntry => h.trip !== null && !h.trip.cancelled_at);

  const today = new Date().toISOString().slice(0, 10);
  const upcoming = allHistory.filter((h) => (h.trip.start_date ?? "9999") >= today);
  const past     = allHistory.filter((h) => (h.trip.start_date ?? "0000") <  today);

  // 6. Mutuals count + top names.
  const { data: mutualRows } = await svc
    .from("mutuals")
    .select("mutual_user_id, shared_trip_count, last_traveled_together_at")
    .eq("user_id", targetUserId)
    .order("shared_trip_count", { ascending: false })
    .limit(8);
  const mutuals = (mutualRows ?? []) as {
    mutual_user_id: string;
    shared_trip_count: number;
    last_traveled_together_at: string | null;
  }[];

  // 7. Travel profile (via phone, per Q2).
  let profile: TravelerProfileSummary | null = null;
  if (target.phone) {
    const { data: tp } = await svc
      .from("traveler_profiles")
      .select("home_airport, vibe_beach_or_mountain, vibe_spa_or_hike, vibe_foodie_or_casual, vibe_social_or_chill, vibe_culture_or_relaxation, budget_comfort, dietary_restrictions")
      .eq("phone", target.phone)
      .maybeSingle();
    if (tp) profile = tp as TravelerProfileSummary;
  }

  return (
    <main className="min-h-dvh bg-cream px-6 py-10">
      <div className="max-w-2xl mx-auto">
        <Link href="/" className="text-sm text-muted hover:text-ink mb-6 inline-block">
          ← Back to Rally
        </Link>

        {/* Header */}
        <header className="flex items-center gap-5 mb-10">
          <Avatar name={safeName} />
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-3xl sm:text-4xl text-ink leading-tight mb-1 truncate">
              {safeName}
            </h1>
            <p className="text-sm text-muted">
              {(target.trip_count ?? 0)} trip{(target.trip_count ?? 0) === 1 ? "" : "s"} ·{" "}
              {mutuals.length} {mutuals.length === 1 ? "person" : "people"} traveled with
            </p>
          </div>
        </header>

        {/* Upcoming trips */}
        {upcoming.length > 0 && (
          <Section title="Upcoming">
            <ul className="grid gap-2">
              {upcoming.map((h) => <TripPill key={h.id} trip={h.trip} />)}
            </ul>
          </Section>
        )}

        {/* Past trips */}
        {past.length > 0 && (
          <Section title="Past trips">
            <ul className="grid gap-2">
              {past.map((h) => <TripPill key={h.id} trip={h.trip} />)}
            </ul>
          </Section>
        )}

        {/* Travel profile */}
        {profile && (
          <Section title="Travel vibes">
            <TravelProfileCard p={profile} />
          </Section>
        )}

        {/* Mutuals */}
        {mutuals.length > 0 && (
          <Section title="Traveled with">
            <p className="text-sm text-muted">
              {mutuals.length} {mutuals.length === 1 ? "person" : "people"} across their trips.
              {mutuals[0]?.last_traveled_together_at && (
                <> Most recent: {formatRelative(mutuals[0].last_traveled_together_at)}.</>
              )}
            </p>
          </Section>
        )}

        {allHistory.length === 0 && !profile && (
          <p className="text-sm text-muted text-center py-12">
            {firstName} hasn&rsquo;t been on any trips yet.
          </p>
        )}
      </div>
    </main>
  );
}

// ─── components ──────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="text-xs font-bold tracking-widest uppercase text-muted mb-3">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Avatar({ name }: { name: string }) {
  const initial = (name.charAt(0) || "?").toUpperCase();
  return (
    <div className="h-20 w-20 sm:h-24 sm:w-24 rounded-full bg-green-soft text-green flex items-center justify-center font-display text-3xl sm:text-4xl font-bold flex-shrink-0">
      {initial}
    </div>
  );
}

interface TripRowShape {
  id: string;
  name: string;
  destination: string | null;
  start_date: string | null;
  end_date: string | null;
  theme: string | null;
  cancelled_at: string | null;
  cover_image_url: string | null;
}

function TripPill({ trip }: { trip: TripRowShape }) {
  return (
    <li className="bg-card border border-line rounded-2xl p-4 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="font-semibold text-ink truncate">{trip.name}</p>
        <p className="text-xs text-muted">
          {trip.destination ?? "—"}
          {trip.start_date && <> · {formatTripDates(trip.start_date, trip.end_date)}</>}
        </p>
      </div>
    </li>
  );
}

interface TravelerProfileSummary {
  home_airport: string | null;
  vibe_beach_or_mountain: string | null;
  vibe_spa_or_hike: string | null;
  vibe_foodie_or_casual: string | null;
  vibe_social_or_chill: string | null;
  vibe_culture_or_relaxation: string | null;
  budget_comfort: string | null;
  dietary_restrictions: string[] | null;
}

function TravelProfileCard({ p }: { p: TravelerProfileSummary }) {
  const vibes: string[] = [];
  if (p.vibe_beach_or_mountain && p.vibe_beach_or_mountain !== "both") vibes.push(p.vibe_beach_or_mountain);
  if (p.vibe_spa_or_hike && p.vibe_spa_or_hike !== "both")             vibes.push(p.vibe_spa_or_hike);
  if (p.vibe_foodie_or_casual && p.vibe_foodie_or_casual !== "both")   vibes.push(p.vibe_foodie_or_casual);
  if (p.vibe_social_or_chill && p.vibe_social_or_chill !== "both")     vibes.push(p.vibe_social_or_chill);
  if (p.vibe_culture_or_relaxation && p.vibe_culture_or_relaxation !== "both") vibes.push(p.vibe_culture_or_relaxation);

  return (
    <div className="bg-card border border-line rounded-2xl p-5 grid gap-3 text-sm">
      {p.home_airport && (
        <Row label="Home airport" value={p.home_airport} />
      )}
      {p.budget_comfort && (
        <Row label="Budget" value={capitalize(p.budget_comfort)} />
      )}
      {vibes.length > 0 && (
        <Row label="Vibes" value={vibes.map(capitalize).join(" · ")} />
      )}
      {p.dietary_restrictions && p.dietary_restrictions.length > 0 && (
        <Row label="Dietary" value={p.dietary_restrictions.join(", ")} />
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs uppercase tracking-widest font-semibold text-muted">{label}</span>
      <span className="text-ink text-right">{value}</span>
    </div>
  );
}

// ─── helpers ──────────────────────────────────────────────────────

function formatTripDates(start: string | null, end: string | null): string {
  if (!start) return "";
  const s = formatMd(start);
  if (!end || end === start) return s;
  return `${s} – ${formatMd(end)}`;
}

function formatMd(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return iso;
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${months[month - 1]} ${day}, ${year}`;
}

function formatRelative(iso: string): string {
  const ago = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ago / 86_400_000);
  if (days < 1)   return "today";
  if (days < 7)   return `${days}d ago`;
  if (days < 30)  return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ");
}
