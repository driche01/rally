import posthog from 'posthog-js';

let initialized = false;

export function initAnalytics() {
  const key = process.env.EXPO_PUBLIC_POSTHOG_KEY;
  const host = process.env.EXPO_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com';
  if (!key || initialized) return;
  posthog.init(key, {
    api_host: host,
    // Capture page views ourselves so we don't double-count with manual calls.
    capture_pageview: false,
    // The respond + landing pages don't benefit from session recording; keep
    // the bundle and network footprint small.
    disable_session_recording: true,
    autocapture: false,
  });
  initialized = true;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function capture(event: string, properties?: Record<string, any>) {
  if (!initialized) return;
  posthog.capture(event, properties);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function identify(userId: string, traits?: Record<string, any>) {
  if (!initialized) return;
  posthog.identify(userId, traits);
}

export function reset() {
  if (!initialized) return;
  posthog.reset();
}

// Mirror the native module's named-event constants so call sites stay platform-neutral.
export const Events = {
  TRIP_CREATED: 'trip_created',
  TRIP_VIEWED: 'trip_viewed',
  POLL_CREATED: 'poll_created',
  POLL_UPDATED: 'poll_updated',
  POLL_CLOSED: 'poll_closed',
  POLL_DECIDED: 'poll_decided',
  SHARE_LINK_COPIED: 'share_link_copied',
  RESPONDENT_SUBMITTED: 'respondent_submitted',
  DOWNLOAD_PROMPT_TAPPED: 'download_prompt_tapped',
  NOTIFICATION_OPTED_IN: 'notification_opted_in',
  TRIP_CLOSED: 'trip_closed',
  RECOMMENDATION_APPROVED: 'recommendation_approved',
  RECOMMENDATION_HELD: 'recommendation_held',
  LOCK_BROADCAST_SENT: 'lock_broadcast_sent',
} as const;
