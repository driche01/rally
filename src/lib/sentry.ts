import * as Sentry from '@sentry/react-native';
import { Platform } from 'react-native';

export function initSentry() {
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
  if (!dsn) return; // no-op in dev until DSN is configured

  Sentry.init({
    dsn,
    environment: __DEV__ ? 'development' : 'production',
    // Only send errors in production to avoid noise
    enabled: !__DEV__,
    // Breadcrumbs help trace steps leading to an error
    maxBreadcrumbs: 50,
    tracesSampleRate: __DEV__ ? 0 : 0.2,
    integrations: [
      Sentry.mobileReplayIntegration({ maskAllText: false }),
    ],
    _experiments: {
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: __DEV__ ? 0 : 1.0,
    },
  });
}

export function captureError(error: unknown, context?: Record<string, unknown>) {
  if (__DEV__) {
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
