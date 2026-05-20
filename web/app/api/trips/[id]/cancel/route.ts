/**
 * /api/trips/[id]/cancel — POST
 *
 * Phase C Step 8: host (or cohost) cancels a trip end-to-end.
 *   1. Set trips.cancelled_at + cancelled_by.
 *   2. Cancel all pending scheduled_reminders for this trip.
 *   3. Send cancellation_notice SMS to every respondent (going,
 *      maybe, invited, cant_go) — suppressing opted-out per Q26.
 *   4. Auto-post a 'system' entry to the activity feed.
 *
 * The trip page renders in a "Cancelled" state after this fires —
 * feed visible but every other write route returns 410 gone if
 * trip.cancelled_at is non-null.
 *
 * Idempotent: re-calling on an already-cancelled trip returns the
 * stored cancellation summary without re-sending SMS.
 */

import { requireAuthUid } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { jsonOk, jsonErr } from "@/lib/http";
import { sendSms } from "@/lib/twilio";
import { getSiteUrl } from "@/lib/site-url";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: trip_id } = await params;
  const r = await requireAuthUid();
  if (!r.ok) return jsonErr(r.status, "unauthenticated");

  const svc = createServiceClient();

  // 1. Host-or-cohost gate.
  const { data: trip } = await svc
    .from("trips")
    .select("id, name, created_by, destination, share_token, cancelled_at, cancelled_by")
    .eq("id", trip_id)
    .maybeSingle();
  if (!trip) return jsonErr(404, "trip_not_found");

  if (trip.cancelled_at) {
    return jsonOk({ already_cancelled: true, cancelled_at: trip.cancelled_at });
  }

  const isPlanner = trip.created_by === r.authUid;
  let isCohost = false;
  if (!isPlanner) {
    const { data: c } = await svc.from("trip_cohosts")
      .select("trip_id").eq("trip_id", trip_id).eq("user_id", r.authUid).maybeSingle();
    isCohost = !!c;
  }
  if (!isPlanner && !isCohost) return jsonErr(403, "forbidden");

  // 2. Stamp the cancellation. Do this FIRST so other writes start
  //    returning 410 immediately — closes the race where someone
  //    mid-action tries to mutate the trip while we're tearing it down.
  const cancelledAt = new Date().toISOString();
  const { error: updErr } = await svc.from("trips").update({
    cancelled_at: cancelledAt,
    cancelled_by: r.authUid,
    updated_at: cancelledAt,
  }).eq("id", trip_id);
  if (updErr) return jsonErr(500, "cancel_failed", updErr.message);

  // 3. Cancel pending scheduled_reminders for this trip. The
  //    polyglot scheduler also short-circuits on trip.cancelled_at,
  //    but doing it explicitly here avoids one wasted scheduler tick.
  await svc.from("scheduled_reminders").update({
    status: "cancelled",
    skip_reason: "trip_cancelled",
    updated_at: cancelledAt,
  }).eq("trip_id", trip_id).eq("status", "pending");

  // 4. Pull every respondent. Q26: include all segments INCLUDING
  //    cant_go (their plans need to be re-planned too) but suppress
  //    opted-out — opt-out filter lives in /web/lib/twilio.ts.
  const { data: respRows } = await svc.from("respondents")
    .select("id, name, phone, rsvp_status, is_planner, user_id")
    .eq("trip_id", trip_id)
    .not("phone", "is", null);
  const respondents = respRows ?? [];

  // 5. Resolve site URL for the cancellation-link in the SMS body.
  //    Uses the canonical getSiteUrl() helper (env var → request
  //    headers → localhost fallback). Critical fix: previously this
  //    route used a local helper that fell back to
  //    "rallysurveys.netlify.app" — the Expo marketing site, not the
  //    Next.js web app. Resulted in cancellation SMS links 404ing.
  const baseUrl = await getSiteUrl();
  const inviteUrl = `${baseUrl}/invite/${trip.share_token}`;

  // 6. Send cancellation_notice to each (skipping the planner —
  //    they just clicked the button, don't ping them).
  let sent = 0;
  let failed = 0;
  let suppressedOptedOut = 0;
  const perRecipient: { name: string; phone: string; status: string; detail?: string }[] = [];

  for (const recip of respondents) {
    if (recip.is_planner && recip.user_id === r.authUid) continue;
    if (!recip.phone) continue;
    const firstName = (recip.name ?? "").split(/\s+/)[0] ?? "there";
    const body = `${firstName} — ${trip.name}${trip.destination ? ` (${trip.destination})` : ""} has been cancelled by the host. Details + feed still live at: ${inviteUrl}`;
    const send = await sendSms(svc, {
      to: recip.phone,
      body,
      tripId: trip_id,
      messageType: "cancellation_notice",
      senderRole: "rally",
    });
    if (send.sid) {
      sent++;
      perRecipient.push({ name: recip.name, phone: recip.phone, status: "sent" });
    } else if (send.error === "opted_out") {
      suppressedOptedOut++;
      perRecipient.push({ name: recip.name, phone: recip.phone, status: "suppressed", detail: "opted_out" });
    } else {
      failed++;
      perRecipient.push({ name: recip.name, phone: recip.phone, status: "failed", detail: send.error ?? "unknown" });
    }
  }

  // 7. Auto-post to activity feed.
  await svc.from("activity_feed_entries").insert({
    trip_id,
    user_id: null,
    entry_type: "system",
    content: {
      kind: "trip_cancelled",
      text: "This trip has been cancelled by the host.",
      sent,
      failed,
      suppressed_opted_out: suppressedOptedOut,
      cancelled_at: cancelledAt,
    },
  });

  return jsonOk({
    cancelled_at: cancelledAt,
    sms: {
      sent,
      failed,
      suppressed_opted_out: suppressedOptedOut,
      recipients: perRecipient,
    },
  });
}

/**
 * Lightweight host-header read — we don't have the Request here
 * (consumed during params await), so fall back to a sane default.
 * The cancellation-notice link doesn't need to be LAN-IP-perfect
 * since the trip is being torn down anyway.
 */
// req_host_for was retired 2026-05-19 in favor of the canonical
// getSiteUrl() helper — its rallysurveys.netlify.app fallback was
// causing cancellation-notice SMS links to 404.
