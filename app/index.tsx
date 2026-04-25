import { Redirect } from 'expo-router';
import { ActivityIndicator, Platform, View } from 'react-native';
import { useAuthStore } from '@/stores/authStore';
import LandingPage from '@/components/landing/LandingPage';

/**
 * Root route.
 *
 * - On web (`/` on rallysurveys.netlify.app): renders the public marketing
 *   landing page. Cold visitors who follow share links or future ad spend
 *   land here. Signed-in web visitors get an "Open Rally" CTA in the nav.
 * - On native (iOS/Android app cold start): keeps the original auth-state
 *   redirect — landing only makes sense for web traffic.
 */
export default function RootIndex() {
  const { session, isLoading } = useAuthStore();

  if (Platform.OS === 'web') {
    return <LandingPage isSignedIn={!!session} />;
  }

  if (isLoading) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#FBF7EF',
        }}
      >
        <ActivityIndicator size="large" color="#0F3F2E" />
      </View>
    );
  }

  return <Redirect href={session ? '/(app)/(tabs)' : '/(auth)/onboarding'} />;
}
