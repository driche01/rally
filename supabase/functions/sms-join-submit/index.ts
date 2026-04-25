/**
 * Supabase Edge Function — sms-join-submit
 *
 * POST endpoint called by the public /join/[code] form. Accepts the
 * submitter's name, phone, and (optional) email; runs the submit_join_link
 * RPC; sends a confirmation SMS asking the recipient to reply YES.
 *
 *   POST /sms-join-submit
 *   { code, phone, display_name, email? }
 *
 * Returns:
 *   200 { ok: true,  reason, planner_name, destination, joined_count }
 *   200 { ok: false, reason }   // user-facing reason (invalid_code, expired, ...)
 *   400 on missing fields
 *
 * Deploy: ./scripts/deploy-sms.sh (extended to include this function).
 *         supabase functions deploy sms-join-submit --no-verify-jwt
 */

import { getAdmin } from '../_sms-shared/supabase.ts';
import { sendDm } from '../_sms-shared/dm-sender.ts';
import { joinConfirmationSms } from '../_sms-shared/templates.ts';
import { captureError, track } from '../_sms-shared/telemetry.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const RESEND_WINDOW_MS = 60_000;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, reason: 'method_not_allowed' }, 405);
  }

  const admin = getAdmin();

  try {
    const payload = await req.json().catch(() => null) as
      | { code?: unknown; phone?: unknown; display_name?: unknown; email?: unknown }
      | null;
    if (!payload) {
      return jsonResponse({ ok: false, reason: 'invalid_body' }, 400);
    }

    const code         = typeof payload.code === 'string' ? payload.code.trim() : '';
    const phone        = typeof payload.phone === 'string' ? payload.phone.trim() : '';
    const displayName  = typeof payload.display_name === 'string' ? payload.display_name.trim() : '';
    const email        = typeof payload.email === 'string' && payload.email.trim()
      ? payload.email.trim()
      : null;

    if (!code || !phone || !displayName) {
      return jsonResponse({ ok: false, reason: 'missing_fields' }, 400);
    }
    if (displayName.length > 60 || (email && email.length > 200)) {
      return jsonResponse({ ok: false, reason: 'field_too_long' }, 400);
    }

    const ipHash = await hashIp(req);

    // ─── Submit ─────────────────────────────────────────────────────────
    const { data: submitResult, error: submitErr } = await admin.rpc('submit_join_link', {
      p_code: code,
      p_phone: phone,
      p_display_name: displayName,
      p_email: email,
      p_ip_hash: ipHash,
    });

    if (submitErr) {
      console.error('[sms-join-submit] submit_join_link error:', submitErr);
      captureError(submitErr, { component: 'sms-join-submit', step: 'submit_rpc' }).catch(() => {});
      return jsonResponse({ ok: false, reason: 'server_error' }, 500);
    }

    const result = submitResult as {
      ok: boolean;
      reason: string;
      submission_id: string | null;
    };

    if (!result.ok) {
      return jsonResponse({ ok: false, reason: result.reason }, 200);
    }

    // already_joined — no SMS needed; surface preview anyway.
    if (result.reason === 'already_joined') {
      const preview = await fetchPreview(admin, code);
      return jsonResponse({ ok: true, reason: 'already_joined', ...preview }, 200);
    }

    // duplicate — submission already exists. Re-send the confirmation only if
    // confirmation_sent_at is older than RESEND_WINDOW_MS (avoid double-tap spam).
    if (result.reason === 'duplicate' && result.submission_id) {
      const { data: row } = await admin
        .from('join_link_submissions')
        .select('id, phone, display_name, confirmation_sent_at, join_link_id')
        .eq('id', result.submission_id)
        .maybeSingle();
      if (row?.confirmation_sent_at) {
        const lastSent = new Date(row.confirmation_sent_at).getTime();
        if (Date.now() - lastSent < RESEND_WINDOW_MS) {
          const preview = await fetchPreview(admin, code);
          return jsonResponse({ ok: true, reason: 'duplicate_recent', ...preview }, 200);
        }
      }
    }

    if (!result.submission_id) {
      // 'created' but no id is impossible; defensive.
      return jsonResponse({ ok: false, reason: 'server_error' }, 500);
    }

    // ─── Send confirmation SMS ──────────────────────────────────────────
    const preview = await fetchPreview(admin, code);
    const { data: submissionRow } = await admin
      .from('join_link_submissions')
      .select('id, phone, display_name, join_link_id, trip_session:join_links!inner(trip_session_id)')
      .eq('id', result.submission_id)
      .maybeSingle();

    if (!submissionRow) {
      return jsonResponse({ ok: false, reason: 'server_error' }, 500);
    }

    const tripSessionId = (submissionRow as unknown as {
      trip_session: { trip_session_id: string };
    }).trip_session?.trip_session_id ?? null;

    const smsBody = joinConfirmationSms({
      recipientName: submissionRow.display_name as string,
      plannerName: preview.planner_name,
      destination: preview.destination,
      dates: preview.dates,
    });

    const sendResult = await sendDm(
      admin,
      submissionRow.phone as string,
      smsBody,
      { tripSessionId, idempotencyKey: `join_confirm_${result.submission_id}` },
    );

    if (sendResult.error) {
      // SMS send failed — surface a soft error so the form can prompt retry.
      // The submission row stays pending; the user can hit "didn't get it?" to retry.
      console.error('[sms-join-submit] send failed:', sendResult.error);
      return jsonResponse({ ok: false, reason: 'sms_send_failed' }, 200);
    }

    await admin
      .from('join_link_submissions')
      .update({ confirmation_sent_at: new Date().toISOString() })
      .eq('id', result.submission_id);

    track('join_link_submitted', {
      distinct_id: tripSessionId ?? result.submission_id,
      tripSessionId,
      submissionId: result.submission_id,
      hasEmail: !!email,
    }).catch(() => {});

    return jsonResponse({ ok: true, reason: 'sent', ...preview }, 200);
  } catch (err) {
    console.error('[sms-join-submit] unhandled:', err);
    captureError(err, { component: 'sms-join-submit' }).catch(() => {});
    return jsonResponse({ ok: false, reason: 'server_error' }, 500);
  }
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

interface JoinLinkPreview {
  planner_name: string | null;
  destination: string | null;
  dates: { start?: string; end?: string } | null;
  joined_names: string[];
  member_count: number;
}

async function fetchPreview(
  admin: ReturnType<typeof getAdmin>,
  code: string,
): Promise<JoinLinkPreview> {
  const { data } = await admin.rpc('get_join_link_preview', { p_code: code });
  const fallback: JoinLinkPreview = {
    planner_name: null,
    destination: null,
    dates: null,
    joined_names: [],
    member_count: 0,
  };
  if (!data || (data as { ok: boolean }).ok === false) return fallback;
  const d = data as JoinLinkPreview & { ok: true };
  return {
    planner_name: d.planner_name ?? null,
    destination:  d.destination ?? null,
    dates:        d.dates ?? null,
    joined_names: d.joined_names ?? [],
    member_count: d.member_count ?? 0,
  };
}

/**
 * Hash the requesting IP into a per-day bucket so the per-IP rate limiter
 * doesn't store raw IPs. UTC-day rollover means the hash changes daily.
 */
async function hashIp(req: Request): Promise<string | null> {
  const fwd = req.headers.get('x-forwarded-for') ?? '';
  const ip = fwd.split(',')[0]?.trim();
  if (!ip) return null;
  const day = new Date().toISOString().slice(0, 10);
  const data = new TextEncoder().encode(`${ip}:${day}`);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
