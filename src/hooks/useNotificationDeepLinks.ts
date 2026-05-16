import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { getInitialNotificationUrl } from '@/lib/notifications';

/**
 * Subscribes to notification taps and pushes the encoded screen URL.
 * Native-only — the `.web.ts` sibling is a no-op so `expo-notifications`
 * never reaches the web bundle.
 */
export function useNotificationDeepLinks() {
  const router = useRouter();
  const subscriptionRef = useRef<Notifications.Subscription | null>(null);

  useEffect(() => {
    // Cold start: handle tap that launched the app.
    Notifications.getLastNotificationResponseAsync().then((response) => {
      const url = getInitialNotificationUrl(response);
      if (url) router.push(url as Parameters<typeof router.push>[0]);
    });

    // Warm: handle taps while the app is running.
    subscriptionRef.current = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const url = getInitialNotificationUrl(response);
        if (url) router.push(url as Parameters<typeof router.push>[0]);
      },
    );

    return () => {
      subscriptionRef.current?.remove();
    };
  }, [router]);
}
