import * as Sentry from '@sentry/browser';

declare const __DEV__: boolean;

export function initSentry() {
  // Skip during static-render (Node) — Sentry's browser SDK touches window.
  if (typeof window === 'undefined') return;
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: __DEV__ ? 'development' : 'production',
    enabled: !__DEV__,
    maxBreadcrumbs: 50,
    tracesSampleRate: __DEV__ ? 0 : 0.2,
  });
}

export function captureError(error: unknown, context?: Record<string, unknown>) {
  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.error('[Sentry]', error, context);
    return;
  }
  Sentry.withScope((scope) => {
    if (context) scope.setExtras(context);
    Sentry.captureException(error);
  });
}

export function setUser(userId: string, email?: string) {
  Sentry.setUser(userId ? { id: userId, email } : null);
}

export function clearUser() {
  Sentry.setUser(null);
}

export { Sentry };
