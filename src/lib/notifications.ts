import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { capture, Events } from './analytics';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

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

export async function getPushToken(): Promise<string | null> {
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Rally notifications',
        importance: Notifications.AndroidImportance.MAX,
      });
    }
    const { data } = await Notifications.getExpoPushTokenAsync();
    return data;
  } catch {
    return null;
  }
}

export function scheduleLocalNotification(title: string, body: string) {
  return Notifications.scheduleNotificationAsync({
    content: { title, body, sound: false },
    trigger: null,
  });
}
