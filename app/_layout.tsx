import '../global.css';
import { QueryClientProvider } from '@tanstack/react-query';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from '@expo-google-fonts/inter';
import {
  SpaceGrotesk_600SemiBold,
  SpaceGrotesk_700Bold,
} from '@expo-google-fonts/space-grotesk';
import * as Notifications from 'expo-notifications';
import { SplashScreen, Stack, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { queryClient } from '@/lib/queryClient';
import { initAnalytics } from '@/lib/analytics';
import { initSentry, setUser, clearUser } from '@/lib/sentry';
import { useAuthListener } from '@/hooks/useAuth';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { getInitialNotificationUrl } from '@/lib/notifications';

if (Platform.OS !== 'web') SplashScreen.preventAutoHideAsync();

// Init Sentry as early as possible (before any React rendering)
initSentry();

function AppInitializer({ children }: { children: React.ReactNode }) {
  useAuthListener();
  const router = useRouter();
  const notificationResponseRef = useRef<Notifications.Subscription | null>(null);

  useEffect(() => {
    // expo-notifications is not available on web
    if (Platform.OS === 'web') return;

    // Handle notification tap when app is killed (cold start)
    Notifications.getLastNotificationResponseAsync().then((response) => {
      const url = getInitialNotificationUrl(response);
      if (url) router.push(url as Parameters<typeof router.push>[0]);
    });

    // Handle notification tap when app is backgrounded
    notificationResponseRef.current =
      Notifications.addNotificationResponseReceivedListener((response) => {
        const url = getInitialNotificationUrl(response);
        if (url) router.push(url as Parameters<typeof router.push>[0]);
      });

    return () => {
      notificationResponseRef.current?.remove();
    };
  }, [router]);

  return <>{children}</>;
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    SpaceGrotesk_600SemiBold,
    SpaceGrotesk_700Bold,
  });

  useEffect(() => {
    initAnalytics();
  }, []);

  useEffect(() => {
    if (fontsLoaded && Platform.OS !== 'web') SplashScreen.hideAsync();
  }, [fontsLoaded]);

  // On web, render immediately with system fonts — don't block on font loading
  // (prevents blank screen on the /respond share link route)
  if (!fontsLoaded && Platform.OS !== 'web') return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <AppInitializer>
            <Stack screenOptions={{ headerShown: false }} />
          </AppInitializer>
        </QueryClientProvider>
      </ErrorBoundary>
    </GestureHandlerRootView>
  );
}
