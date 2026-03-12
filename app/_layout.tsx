import '../global.css';
import { QueryClientProvider } from '@tanstack/react-query';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from '@expo-google-fonts/inter';
import { SplashScreen, Stack } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { queryClient } from '@/lib/queryClient';
import { initAnalytics } from '@/lib/analytics';
import { useAuthListener } from '@/hooks/useAuth';
import { ErrorBoundary } from '@/components/ErrorBoundary';

if (Platform.OS !== 'web') SplashScreen.preventAutoHideAsync();

function AppInitializer({ children }: { children: React.ReactNode }) {
  useAuthListener();
  return <>{children}</>;
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
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
