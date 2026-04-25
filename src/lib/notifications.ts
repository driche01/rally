import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { capture, Events } from './analytics';
import { supabase } from './supabase';
import { T } from '../theme';

// Show banner + sound while app is foregrounded
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

const EAS_PROJECT_ID = '36b0541b-e001-4129-af1b-11b5ee16bc58';

// ─── Permission ───────────────────────────────────────────────────────────────

export async function requestNotificationPermission(): Promise<boolean> {
  if (!Device.isDevice) return false;

  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === 'granted') return true;

  const { status } = await Notifications.requestPermissionsAsync();
  if (status === 'granted') {
    capture(Events.NOTIFICATION_OPTED_IN);
    return true;
  }
  return false;
}

// ─── Token management ─────────────────────────────────────────────────────────

/**
 * Requests permission, fetches the Expo push token, and persists it to Supabase
 * for the currently-authenticated user. Safe to call multiple times — upserts.
 * Call this once after successful login.
 */
export async function registerPushToken(): Promise<void> {
  if (!Device.isDevice) return;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Rally',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: T.green,
    });
  }

  const granted = await requestNotificationPermission();
  if (!granted) return;

  let token: string;
  try {
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId: EAS_PROJECT_ID });
    token = data;
  } catch {
    // Non-fatal — app works without push
    return;
  }

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  const platform = Platform.OS === 'ios' ? 'ios' : 'android';
  await supabase
    .from('push_tokens')
    .upsert({ user_id: user.id, token, platform }, { onConflict: 'user_id,token' });
}

/**
 * Removes this device's push token from Supabase on logout.
 * Prevents notifications being delivered to signed-out devices.
 */
export async function deregisterPushToken(): Promise<void> {
  if (!Device.isDevice) return;

  let token: string;
  try {
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId: EAS_PROJECT_ID });
    token = data;
  } catch {
    return;
  }

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  await supabase
    .from('push_tokens')
    .delete()
    .eq('user_id', user.id)
    .eq('token', token);
}

// ─── Legacy helpers (Phase 1 compat) ─────────────────────────────────────────

export async function getPushToken(): Promise<string | null> {
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Rally notifications',
        importance: Notifications.AndroidImportance.MAX,
      });
    }
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId: EAS_PROJECT_ID });
    return data;
  } catch {
    return null;
  }
}

export function scheduleLocalNotification(title: string, body: string) {
  return Notifications.scheduleNotificationAsync({
    content: { title, body, sound: true },
    trigger: null,
  });
}

// ─── Deep-link data payloads ──────────────────────────────────────────────────
//
// These shapes are read by getInitialNotificationUrl() to determine which
// screen to navigate to when the user taps a notification.

export const NotificationData = {
  planConfirmed: (tripId: string) => ({
    type: 'plan_confirmed' as const,
    tripId,
    screen: `/(app)/trips/${tripId}`,
  }),
  newMessage: (tripId: string, messageId: string) => ({
    type: 'new_message' as const,
    tripId,
    messageId,
    screen: `/(app)/trips/${tripId}/chat`,
  }),
  expenseAdded: (tripId: string) => ({
    type: 'expense_added' as const,
    tripId,
    screen: `/(app)/trips/${tripId}/expenses`,
  }),
  itineraryPublished: (tripId: string) => ({
    type: 'itinerary_published' as const,
    tripId,
    screen: `/(app)/trips/${tripId}/itinerary`,
  }),
};

/**
 * Extracts the deep-link screen path from a notification tap response.
 * Pass the result of Notifications.getLastNotificationResponseAsync() here.
 */
export function getInitialNotificationUrl(
  response: Notifications.NotificationResponse | null
): string | null {
  if (!response) return null;
  const data = response.notification.request.content.data as Record<string, unknown>;
  return (data?.screen as string) ?? null;
}
