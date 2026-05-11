/**
 * Server-side Twilio sender. Mirrors the behavior of
 * supabase/functions/_sms-shared/dm-sender.ts but for the Node.js
 * runtime that Next.js route handlers use.
 *
 * Every send writes a `thread_messages` row with direction='outbound',
 * trip_id, message_type, body, twilio_sid, delivery_status='sent' (or
 * 'failed'). This is the same log the legacy edge-function rail uses;
 * Phase A's invitation send reuses it for continuity (per Q5 RESOLVED).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { SmsMessageType } from "@shared/types";

interface SendOpts {
  to: string;                    // E.164
  body: string;
  tripId: string | null;
  messageType: SmsMessageType;
  senderRole?: string;
}

interface SendResult {
  sid: string | null;
  error: string | null;
}

export async function sendSms(
  admin: SupabaseClient,
  opts: SendOpts,
): Promise<SendResult> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID ?? "";
  const authToken = process.env.TWILIO_AUTH_TOKEN ?? "";
  const fromPhone = process.env.TWILIO_PHONE_NUMBER ?? "";
  if (!accountSid || !authToken || !fromPhone) {
    return { sid: null, error: "twilio_not_configured" };
  }
  if (!opts.to || !opts.body) {
    return { sid: null, error: "missing_args" };
  }

  const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
  const formBody = new URLSearchParams({
    To:   opts.to,
    From: fromPhone,
    Body: opts.body,
  });

  let sid: string | null = null;
  let err: string | null = null;
  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: formBody,
      },
    );
    const data = (await res.json()) as { sid?: string; message?: string; code?: number };
    if (!res.ok) {
      err = data.message ?? `twilio_${res.status}`;
    } else {
      sid = data.sid ?? null;
    }
  } catch (e) {
    err = e instanceof Error ? e.message : "network_error";
  }

  // Log every attempt — success or failure. Service-role bypass on
  // thread_messages RLS is fine; this table is the SMS audit trail.
  await admin.from("thread_messages").insert({
    direction: "outbound",
    trip_id: opts.tripId,
    sender_phone: opts.to,        // log the recipient under sender_phone
                                  // to match the legacy nudge_sends naming
                                  // (legacy code uses sender_phone for the
                                  // "other side of the conversation").
    sender_role: opts.senderRole ?? "rally",
    body: opts.body,
    message_sid: sid,
    message_type: opts.messageType,
    delivery_status: sid ? "sent" : "failed",
    delivery_status_at: new Date().toISOString(),
    error_code: err,
  });

  return { sid, error: err };
}
