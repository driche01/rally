/**
 * Lightweight telemetry for the Deno edge functions.
 *
 * No-ops when env vars are unset, so safe to ship without secrets configured.
 * We use raw `fetch` to Sentry's envelope endpoint and PostHog's capture
 * endpoint rather than pulling in the full SDKs — keeps bundle size small
 * and avoids Deno/Node compatibility pain.
 *
 * Env vars:
 *   SENTRY_DSN     e.g. https://<key>@o<org>.ingest.sentry.io/<project>
 *   POSTHOG_KEY    server-side project API key (starts with phc_)
 *   POSTHOG_HOST   defaults to https://us.i.posthog.com
 *
 * Set them with:
 *   npx supabase secrets set SENTRY_DSN=... POSTHOG_KEY=... --project-ref <ref>
 */

// ─── Sentry ──────────────────────────────────────────────────────────────────

interface ParsedDsn {
  host: string;
  projectId: string;
  publicKey: string;
}

let cachedDsn: ParsedDsn | null | undefined = undefined;

function parseDsn(): ParsedDsn | null {
  if (cachedDsn !== undefined) return cachedDsn;
  const raw = Deno.env.get('SENTRY_DSN');
  if (!raw) {
    cachedDsn = null;
    return null;
  }
  try {
    const url = new URL(raw);
    const projectId = url.pathname.replace(/^\//, '');
    if (!projectId || !url.username) {
      cachedDsn = null;
      return null;
    }
    cachedDsn = {
      host: url.host,
      projectId,
      publicKey: url.username,
    };
    return cachedDsn;
  } catch {
    cachedDsn = null;
    return null;
  }
}

/**
 * Send a captured exception to Sentry via the envelope API.
 * Fire-and-forget — errors in telemetry never propagate to the caller.
 */
export async function captureError(
  err: unknown,
  context?: Record<string, unknown>,
): Promise<void> {
  const dsn = parseDsn();
  if (!dsn) {
    console.error('[telemetry]', err, context);
    return;
  }

  try {
    const eventId = crypto.randomUUID().replace(/-/g, '');
    const timestamp = new Date().toISOString();
    const message = err instanceof Error ? err.message : String(err);
    const stacktrace = err instanceof Error && err.stack
      ? { frames: [{ filename: 'edge-function', function: message }] }
      : undefined;

    const event = {
      event_id: eventId,
      timestamp,
      platform: 'javascript',
      environment: Deno.env.get('SUPABASE_ENV') ?? 'production',
      exception: {
        values: [{
          type: err instanceof Error ? (err.name || 'Error') : 'Error',
          value: message,
          ...(stacktrace ? { stacktrace } : {}),
        }],
      },
      extra: context ?? {},
      tags: { source: 'sms-edge-function' },
    };

    const envelope = [
      JSON.stringify({ event_id: eventId, sent_at: timestamp, dsn: Deno.env.get('SENTRY_DSN') }),
      JSON.stringify({ type: 'event' }),
      JSON.stringify(event),
    ].join('\n');

    const url = `https://${dsn.host}/api/${dsn.projectId}/envelope/`;
    await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-sentry-envelope',
        'X-Sentry-Auth': `Sentry sentry_version=7,sentry_client=rally-sms/1.0,sentry_key=${dsn.publicKey}`,
      },
      body: envelope,
    });
  } catch (telErr) {
    console.error('[telemetry] sentry send failed:', telErr);
  }
}

// ─── PostHog ─────────────────────────────────────────────────────────────────

/**
 * Track a server-side event in PostHog. No-op if POSTHOG_KEY unset.
 * The `distinct_id` is the session ID or user ID — passed via properties.
 */
export async function track(
  event: string,
  properties: Record<string, unknown> & { distinct_id?: string } = {},
): Promise<void> {
  const key = Deno.env.get('POSTHOG_KEY');
  if (!key) return;

  const host = Deno.env.get('POSTHOG_HOST') ?? 'https://us.i.posthog.com';
  const distinctId = properties.distinct_id
    ?? (properties.sessionId as string | undefined)
    ?? (properties.userId as string | undefined)
    ?? 'anonymous';

  const payload = {
    api_key: key,
    event,
    distinct_id: distinctId,
    properties: {
      ...properties,
      $source: 'sms-edge-function',
    },
    timestamp: new Date().toISOString(),
  };

  try {
    await fetch(`${host}/capture/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error('[telemetry] posthog send failed:', err);
  }
}
