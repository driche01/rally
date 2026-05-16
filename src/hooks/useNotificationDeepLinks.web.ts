// Web has no push notifications — keep `expo-notifications` and the
// rest of `src/lib/notifications.ts` (which calls `setNotificationHandler`
// at module load) out of the web bundle entirely.
export function useNotificationDeepLinks() {
  /* no-op */
}
