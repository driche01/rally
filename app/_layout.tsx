import '../global.css';
import { QueryClientProvider } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
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
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import { queryClient, queryPersister, QUERY_PERSIST_MAX_AGE } from '@/lib/queryClient';
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
      {/* SafeAreaProvider must wrap everything that calls useSafeAreaInsets().
          Passing initialMetrics avoids a one-frame layout flash on cold start —
          insets are correct from the very first render instead of after the
          provider measures them. */}
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <ErrorBoundary>
          {/* On web, plain QueryClientProvider — AsyncStorage shims to
              localStorage there and the web surfaces (respond, landing)
              don't benefit from cross-session persistence anyway. On
              native, hydrate the in-memory cache from AsyncStorage so a
              cold start renders cached trip / itinerary / lodging data
              without network round-trips. */}
          {Platform.OS === 'web' ? (
            <QueryClientProvider client={queryClient}>
              <AppInitializer>
                <Stack screenOptions={{ headerShown: false }} />
              </AppInitializer>
            </QueryClientProvider>
          ) : (
            <PersistQueryClientProvider
              client={queryClient}
              persistOptions={{
                persister: queryPersister,
                maxAge: QUERY_PERSIST_MAX_AGE,
                // Bump this when the cache shape changes incompatibly
                // (e.g. signature format updates) so old persisted state
                // is discarded on launch instead of rehydrating into a
                // newer schema. Keep in sync with `queryPersister.key`.
                buster: 'rally-rq-cache-v1',
                dehydrateOptions: {
                  // Don't persist mutation state — only completed query data.
                  shouldDehydrateMutation: () => false,
                  shouldDehydrateQuery: (q) => q.state.status === 'success',
                },
              }}
            >
              <AppInitializer>
                <Stack screenOptions={{ headerShown: false }} />
              </AppInitializer>
            </PersistQueryClientProvider>
          )}
        </ErrorBoundary>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
