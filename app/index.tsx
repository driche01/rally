import { Redirect } from 'expo-router';
import { useAuthStore } from '@/stores/authStore';
import { View, ActivityIndicator } from 'react-native';

export default function RootIndex() {
  const { session, isLoading } = useAuthStore();

  if (isLoading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FAFAFA' }}>
        <ActivityIndicator size="large" color="#FF6B5B" />
      </View>
    );
  }

  return <Redirect href={session ? '/(app)/(tabs)' : '/(auth)/login'} />;
}
