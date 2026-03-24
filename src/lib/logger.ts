/**
 * Structured logger — thin wrapper over console + Sentry breadcrumbs + PostHog.
 *
 * Usage:
 *   log.action('trip_created', { tripId });
 *   log.error('fetch_failed', error, { tripId });
 *   log.screen('TripDetail');
 */
import { Sentry } from './sentry';
import { capture } from './analytics';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function breadcrumb(category: string, message: string, data?: Record<string, any>, level: 'info' | 'warning' | 'error' = 'info') {
  Sentry.addBreadcrumb({ category, message, data, level });
}

const log = {
  /** Log a user action — sent to PostHog + Sentry breadcrumb */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  action(event: string, properties?: Record<string, any>) {
    if (__DEV__) console.log(`[action] ${event}`, properties);
    capture(event, properties);
    breadcrumb('action', event, properties);
  },

  /** Log a screen view */
  screen(screenName: string) {
    if (__DEV__) console.log(`[screen] ${screenName}`);
    capture('screen_viewed', { screen: screenName });
    breadcrumb('navigation', screenName);
  },

  /** Log an error — sent to Sentry, with optional PostHog event */
  error(context: string, error: unknown, extras?: Record<string, unknown>) {
    const message = error instanceof Error ? error.message : String(error);
    if (__DEV__) console.error(`[error] ${context}`, error, extras);
    breadcrumb('error', `${context}: ${message}`, extras as Record<string, unknown> | undefined, 'error');
    Sentry.withScope((scope) => {
      scope.setTag('context', context);
      if (extras) scope.setExtras(extras);
      Sentry.captureException(error);
    });
  },

  /** Log a debug message (dev only) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  debug(message: string, data?: Record<string, any>) {
    if (__DEV__) console.log(`[debug] ${message}`, data);
    breadcrumb('debug', message, data);
  },
};

export { log };
