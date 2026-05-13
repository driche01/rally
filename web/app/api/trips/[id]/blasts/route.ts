/**
 * /api/trips/[id]/blasts
 *   GET  — list past blasts for this trip (host or cohost)
 *   POST — compose + send a new planner blast
 *
 * Per Phase C Q21 (RESOLVED): a clean new send pipeline, designed
 * for the Phase C contract (trip_id + segment via respondents, host-
 * or-cohost auth, rate limits, auto-post to feed). The legacy
 * `sms-broadcast` edge function is on the post-Phase-C cleanup list.
 *
 * Per Q23: every send goes through web/lib/twilio.ts which checks
 * users.opted_out.
 *
 * Per Q24: blast recipients come from `respondents` filtered by
 * `rsvp_status` + `is_planner` (excluded by default; include via
 * the `include_planner` flag).
 *
 * Per build guide §5 rate limits:
 *   - 3 blasts per rolling 7-day window per trip
 *   - 10 blasts per trip lifetime
 *   - 2 outbound SMS per 24h per recipient (cross-source)
 */

import { requireAuthUid } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { jsonOk, jsonErr } from "@/lib/http";
import { sendSms } from "@/lib/twilio";
import { getTripBlastLimits, filterRecipientsBy24hLimit } from "@/lib/blasts/rate-limits";
import type {
  PlannerBlast,
  RecipientSegment,
  Respondent,
} from "@shared/types";

const ALLOWED_SEGMENTS: ReadonlySet<RecipientSegment> = new Set([
  "going", "maybe", "invited", "all",
]);
const MIN_BODY = 1;
const MAX_BODY = 1600;

// ─── GET: list past blasts ─────────────────────────────────────────

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: trip_id } = await params;
  const r = await requireAuthUid();
  if (!r.ok) return jsonErr(r.status, "unauthenticated");

  // RLS on planner_blasts already gates this. Service client just for
  // the limits sidecar query — RLS-aware client returns the rows.
  const { data, error } = await r.supabase
    .from("planner_blasts")
    .select("*")
    .eq("trip_id", trip_id)
    .order("created_at", { ascending: false });
  if (error) return jsonErr(500, "blasts_list_failed", error.message);

  const svc = createServiceClient();
  const limits = await getTripBlastLimits(svc, trip_id);
  return jsonOk({ blasts: data as PlannerBlast[], limits });
}

// ─── POST: compose + send ──────────────────────────────────────────

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: trip_id } = await params;
  const r = await requireAuthUid();
  if (!r.ok) return jsonErr(r.status, "unauthenticated");

  const body = await safeJson(req);
  if (!body) return jsonErr(400, "invalid_json");

  const recipient_segment = String(body.recipient_segment ?? "") as RecipientSegment;
  const message_body      = String(body.message_body ?? "").trim();
  const include_planner   = Boolean(body.include_planner ?? false);

  if (!ALLOWED_SEGMENTS.has(recipient_segment)) return jsonErr(400, "invalid_segment");
  if (message_body.length < MIN_BODY)            return jsonErr(400, "body_empty");
  if (message_body.length > MAX_BODY)            return jsonErr(400, "body_too_long");

  const svc = createServiceClient();

  // 1. Host-or-cohost gate.
  const { data: trip } = await svc
    .from("trips")
    .select("id, name, created_by, cancelled_at, share_token")
    .eq("id", trip_id)
    .maybeSingle();
  if (!trip) return jsonErr(404, "trip_not_found");
  if (trip.cancelled_at) return jsonErr(410, "trip_cancelled");

  const isPlanner = trip.created_by === r.authUid;
  let isCohost = false;
  if (!isPlanner) {
    const { data: c } = await svc
      .from("trip_cohosts").select("trip_id")
      .eq("trip_id", trip_id).eq("user_id", r.authUid).maybeSingle();
    isCohost = !!c;
  }
  if (!isPlanner && !isCohost) return jsonErr(403, "forbidden");

  // 2. Rate-limit math.
  const limits = await getTripBlastLimits(svc, trip_id);
  if (!limits.can_send) {
    return jsonErr(429, "rate_limit_exceeded", JSON.stringify(limits));
  }

  // 3. Resolve recipient list from respondents.
  let recipientQuery = svc.from("respondents")
    .select("id, name, phone, rsvp_status, is_planner")
    .eq("trip_id", trip_id)
    .not("phone", "is", null);
  if (recipient_segment !== "all") {
    recipientQuery = recipientQuery.eq("rsvp_status", recipient_segment);
  }
  if (!include_planner) {
    recipientQuery = recipientQuery.eq("is_planner", false);
  }
  const { data: candidates } = await recipientQuery;
  const allCandidates = (candidates ?? []) as Pick<Respondent, "id" | "name" | "phone" | "rsvp_status" | "is_planner">[];

  if (allCandidates.length === 0) {
    return jsonErr(400, "no_recipients", `Segment '${recipient_segment}' is empty`);
  }

  // 4. 24h rate-limit filter (cross-source).
  const phones = allCandidates.map((c) => c.phone!).filter(Boolean);
  const { allowed, suppressed: suppressed24h } = await filterRecipientsBy24hLimit(svc, phones);
  const allowedSet = new Set(allowed);
  const sendable = allCandidates.filter((c) => allowedSet.has(c.phone!));

  if (sendable.length === 0) {
    return jsonErr(429, "all_recipients_over_24h_limit", `${suppressed24h.length} recipients are over the 2/24h limit`);
  }

  // 5. Create planner_blasts row first so SMS rows can FK to it.
  const { data: blastRow, error: blastErr } = await svc
    .from("planner_blasts")
    .insert({
      trip_id,
      composed_by: r.authUid,
      recipient_segment,
      message_body,
      include_planner,
      recipient_count: sendable.length,
      sent_count: 0,
      failed_count: 0,
      suppressed_opted_out: 0,
      auto_posted_to_feed: true,
    })
    .select("*")
    .single();
  if (blastErr || !blastRow) {
    return jsonErr(500, "blast_insert_failed", blastErr?.message ?? "");
  }
  const blast = blastRow as PlannerBlast;

  // 6. Per-recipient send loop.
  let sent = 0;
  let failed = 0;
  let suppressedOpt = 0;
  const perRecipient: { phone: string; name: string; status: string; detail?: string }[] = [];

  for (const recipient of sendable) {
    // Personalize per recipient.
    const personalized = message_body.replace(/\[Name\]/g, firstName(recipient.name));
    const send = await sendSms(svc, {
      to: recipient.phone!,
      body: personalized,
      tripId: trip_id,
      messageType: "planner_blast",
      senderRole: "planner",
    });

    // Find the thread_messages row we just wrote (sendSms inserts it).
    let threadId: string | null = null;
    if (send.sid) {
      const { data: tm } = await svc.from("thread_messages")
        .select("id").eq("message_sid", send.sid).maybeSingle();
      threadId = tm?.id ?? null;
    }

    // Per-recipient ledger row regardless of outcome.
    await svc.from("planner_blast_sends").insert({
      blast_id: blast.id,
      recipient_respondent_id: recipient.id,
      thread_message_id: threadId,
      delivery_status: send.error ?? "sent",
      error_code: send.error,
      sent_at: send.sid ? new Date().toISOString() : null,
    });

    if (send.sid) {
      sent++;
      perRecipient.push({ phone: recipient.phone!, name: recipient.name, status: "sent" });
    } else if (send.error === "opted_out") {
      suppressedOpt++;
      perRecipient.push({ phone: recipient.phone!, name: recipient.name, status: "suppressed", detail: "opted_out" });
    } else {
      failed++;
      perRecipient.push({ phone: recipient.phone!, name: recipient.name, status: "failed", detail: send.error ?? "unknown" });
    }
  }

  // 7. Auto-post to activity feed.
  let activityFeedEntryId: string | null = null;
  const { data: feedRow } = await svc.from("activity_feed_entries").insert({
    trip_id,
    user_id: null,                            // planner_post entries are author-less in feed shape
    entry_type: "planner_post",
    content: {
      kind: "planner_blast",
      message: message_body,
      segment: recipient_segment,
      sent,
      failed,
      suppressed: suppressedOpt + suppressed24h.length,
    },
  }).select("id").single();
  activityFeedEntryId = feedRow?.id ?? null;

  // 8. Update the blast row with final counts + feed link.
  await svc.from("planner_blasts").update({
    sent_count: sent,
    failed_count: failed,
    suppressed_opted_out: suppressedOpt,
    activity_feed_entry_id: activityFeedEntryId,
    sent_at: new Date().toISOString(),
  }).eq("id", blast.id);

  return jsonOk({
    blast_id: blast.id,
    sent,
    failed,
    suppressed_opted_out: suppressedOpt,
    suppressed_24h: suppressed24h.length,
    recipients: perRecipient,
    limits_remaining: {
      weekly:   Math.max(0, limits.weekly_remaining   - 1),
      lifetime: Math.max(0, limits.lifetime_remaining - 1),
    },
  });
}

function firstName(full: string): string {
  return full.split(/\s+/)[0] ?? full;
}

async function safeJson(req: Request): Promise<Record<string, unknown> | null> {
  try { return (await req.json()) as Record<string, unknown>; }
  catch { return null; }
}
