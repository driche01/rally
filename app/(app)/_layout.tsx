import { Redirect, Stack } from 'expo-router';
import { useAuthStore } from '@/stores/authStore';

export default function AppLayout() {
  const { session, isLoading } = useAuthStore();

  if (!isLoading && !session) {
    return <Redirect href="/(auth)/login" />;
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
        contentStyle: { backgroundColor: '#FAFAFA' },
      }}
    />
  );
}
