/**
 * POST /api/trips/[id]/invitations
 *
 * Authed planner/cohost sends invitations to a list of recipients.
 * Build guide §6 Step 6.
 *
 * Body: {
 *   recipients: { name: string; phone: string; email?: string }[],
 *   custom_message?: string,   // optional planner override, ≤480 chars
 * }
 *
 * Flow:
 *   1. Validate planner = trips.created_by OR is a cohost
 *   2. Validate every recipient (name ≤30, phone normalizable)
 *   3. For each recipient: find or create a respondent (rsvp_status
 *      = 'invited', invited_by, invited_at, fresh session_token)
 *   4. Compose SMS body per recipient (custom_message + share link)
 *   5. Fire SMS via /web/lib/twilio.ts → thread_messages row logged
 *   6. Auto-post a system entry to the activity feed summarizing the
 *      send (planner-facing audit, anon-readable on the invite page)
 *
 * Returns { sent: number, failed: number, recipients: [{phone,
 * status: 'sent'|'failed'|'dupe'|'skipped'}] }.
 */

import { requireAuthUid } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { normalizePhone } from "@/lib/phone";
import { sendSms } from "@/lib/twilio";
import { jsonErr, jsonOk } from "@/lib/http";
import { randomBytes } from "node:crypto";

const MAX_RECIPIENTS = 50;
const MAX_CUSTOM_MESSAGE = 480;
const MAX_NAME = 30;

interface RecipientInput {
  name?: unknown;
  phone?: unknown;
  email?: unknown;
}

interface RecipientResult {
  phone: string;
  name: string;
  status: "sent" | "failed" | "dupe" | "skipped";
  detail?: string;
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const r = await requireAuthUid();
  if (!r.ok) return jsonErr(r.status, "unauthenticated");
  const { id: trip_id } = await ctx.params;

  const body = await safeJson(req);
  if (!body) return jsonErr(400, "invalid_json");

  const rawRecipients = Array.isArray(body.recipients) ? body.recipients : null;
  if (!rawRecipients || rawRecipients.length === 0) {
    return jsonErr(400, "no_recipients");
  }
  if (rawRecipients.length > MAX_RECIPIENTS) {
    return jsonErr(400, "too_many_recipients");
  }

  const custom_message = typeof body.custom_message === "string"
    ? body.custom_message.trim().slice(0, MAX_CUSTOM_MESSAGE)
    : "";

  // 1. Authorize: caller is planner or cohost of this trip.
  const { data: trip, error: tripErr } = await r.supabase
    .from("trips")
    .select("id, name, created_by, share_token")
    .eq("id", trip_id)
    .maybeSingle();
  if (tripErr)  return jsonErr(500, "trip_read_failed", tripErr.message);
  if (!trip)    return jsonErr(404, "trip_not_found");

  const isPlanner = trip.created_by === r.authUid;
  let isCohost = false;
  if (!isPlanner) {
    const { data: cohost } = await r.supabase
      .from("trip_cohosts")
      .select("trip_id")
      .eq("trip_id", trip_id)
      .eq("user_id", r.authUid)
      .maybeSingle();
    isCohost = !!cohost;
  }
  if (!isPlanner && !isCohost) return jsonErr(403, "forbidden");

  // 2. Resolve planner's display name + this user's Rally id (for
  //    invited_by FK to users.id, per Q1).
  const svc = createServiceClient();
  const { data: plannerProfile } = await svc
    .from("profiles")
    .select("name, last_name")
    .eq("id", trip.created_by)
    .maybeSingle();
  const plannerName = plannerProfile?.name ?? "A friend";

  const { data: rallyUser } = await svc
    .from("users")
    .select("id")
    .eq("auth_user_id", r.authUid)
    .maybeSingle();
  const invited_by = rallyUser?.id ?? null;

  // 3. Validate + normalize each recipient.
  type Cleaned = { name: string; phone: string; email: string | null };
  const cleaned: Cleaned[] = [];
  const results: RecipientResult[] = [];

  for (const raw of rawRecipients as RecipientInput[]) {
    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    const rawPhone = typeof raw.phone === "string" ? raw.phone.trim() : "";
    const email = typeof raw.email === "string" ? raw.email.trim() : "";
    const phone = normalizePhone(rawPhone);

    if (!name) {
      results.push({ phone: rawPhone, name: "", status: "skipped", detail: "missing_name" });
      continue;
    }
    if (name.length > MAX_NAME) {
      results.push({ phone: rawPhone, name, status: "skipped", detail: "name_too_long" });
      continue;
    }
    if (!phone) {
      results.push({ phone: rawPhone, name, status: "skipped", detail: "invalid_phone" });
      continue;
    }
    cleaned.push({ name, phone, email: email || null });
  }

  if (cleaned.length === 0) {
    return jsonOk({ sent: 0, failed: 0, recipients: results });
  }

  // 4. Dedupe within the batch — same phone twice in one send is the
  //    most common copy-paste mistake.
  const seen = new Set<string>();
  const unique: Cleaned[] = [];
  for (const c of cleaned) {
    if (seen.has(c.phone)) {
      results.push({ phone: c.phone, name: c.name, status: "dupe" });
      continue;
    }
    seen.add(c.phone);
    unique.push(c);
  }

  // 5. Look up existing respondents for this trip+phone to decide
  //    upsert vs insert. We never re-send to a phone that's already
  //    'going' or 'cant_go' — that would be annoying.
  const { data: existingRows } = await svc
    .from("respondents")
    .select("id, phone, name, session_token, rsvp_status")
    .eq("trip_id", trip_id)
    .in("phone", unique.map((u) => u.phone));
  const existingByPhone = new Map(
    (existingRows ?? []).map((e) => [e.phone as string, e]),
  );

  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const inviteUrl = `${baseUrl}/invite/${trip.share_token}`;

  let sent = 0;
  let failed = 0;

  for (const c of unique) {
    const existing = existingByPhone.get(c.phone);

    // Skip re-sends to confirmed/declined invitees.
    if (existing && (existing.rsvp_status === "going" || existing.rsvp_status === "cant_go")) {
      results.push({ phone: c.phone, name: c.name, status: "dupe", detail: "already_rsvped" });
      continue;
    }

    let respondentId: string;
    if (existing) {
      respondentId = existing.id as string;
      const patch: Record<string, unknown> = {
        rsvp_status: "invited",
        invited_by,
        invited_at: new Date().toISOString(),
      };
      if (!existing.name || existing.name.trim() === "") patch.name = c.name;
      await svc.from("respondents").update(patch).eq("id", respondentId);
    } else {
      const session_token = randomBytes(16).toString("hex");
      const { data: ins, error: insErr } = await svc
        .from("respondents")
        .insert({
          trip_id,
          name: c.name,
          phone: c.phone,
          email: c.email,
          session_token,
          is_planner: false,
          rsvp_status: "invited",
          rsvp_status_updated_at: new Date().toISOString(),
          invited_by,
          invited_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (insErr || !ins) {
        results.push({ phone: c.phone, name: c.name, status: "failed", detail: insErr?.message ?? "insert_failed" });
        failed++;
        continue;
      }
      respondentId = ins.id;
    }

    // 6. Fire SMS.
    const body = composeBody({
      recipientName: c.name,
      plannerName,
      tripName: trip.name,
      customMessage: custom_message,
      inviteUrl,
    });
    const send = await sendSms(svc, {
      to: c.phone,
      body,
      tripId: trip_id,
      messageType: "rsvp_nudge",
      senderRole: "rally",
    });
    if (send.error) {
      results.push({ phone: c.phone, name: c.name, status: "failed", detail: send.error });
      failed++;
    } else {
      results.push({ phone: c.phone, name: c.name, status: "sent" });
      sent++;
    }
  }

  // 7. Auto-post a system entry to the activity feed.
  if (sent + failed > 0) {
    await svc.from("activity_feed_entries").insert({
      trip_id,
      user_id: invited_by,
      entry_type: "system",
      content: {
        text: `${plannerName} sent ${sent} invitation${sent === 1 ? "" : "s"}${
          failed > 0 ? ` (${failed} failed)` : ""
        }`,
        kind: "invitations_sent",
        sent,
        failed,
      },
    });
  }

  return jsonOk({ sent, failed, recipients: results });
}

function composeBody({
  recipientName,
  plannerName,
  tripName,
  customMessage,
  inviteUrl,
}: {
  recipientName: string;
  plannerName: string;
  tripName: string;
  customMessage: string;
  inviteUrl: string;
}): string {
  const first = recipientName.split(/\s+/)[0];
  const intro = customMessage
    ? customMessage
    : `${plannerName} invited you to ${tripName}.`;
  return `Hey ${first} — ${intro} RSVP: ${inviteUrl}`;
}

async function safeJson(req: Request): Promise<Record<string, unknown> | null> {
  try { return (await req.json()) as Record<string, unknown>; }
  catch { return null; }
}
