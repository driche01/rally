import PostHog from 'posthog-react-native';

let client: PostHog | null = null;

export function initAnalytics() {
  const key = process.env.EXPO_PUBLIC_POSTHOG_KEY;
  const host = process.env.EXPO_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com';
  if (!key) return;
  client = new PostHog(key, { host });
}

// PostHog accepts JSON-serialisable values; use `any` to satisfy its strict index signature
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function capture(event: string, properties?: Record<string, any>) {
  client?.capture(event, properties);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function identify(userId: string, traits?: Record<string, any>) {
  client?.identify(userId, traits);
}

export function reset() {
  client?.reset();
}

// Named events for consistency
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
} as const;
