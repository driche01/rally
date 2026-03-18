/**
 * Account screen — profile info, sign-out, and app version.
 */

import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSignOut } from '@/hooks/useAuth';
import { useAuthStore } from '@/stores/authStore';

export default function AccountScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();
  const signOut = useSignOut();

  const name = user?.user_metadata?.name as string | undefined;
  const email = user?.email;

  // Build initials from name if available, otherwise fall back to first letter of email
  const initials = name
    ? name
        .split(' ')
        .map((w) => w[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)
    : (email?.[0]?.toUpperCase() ?? '?');

  function handleSignOut() {
    Alert.alert('Sign out?', "You'll need to sign back in to access your trips.", [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => signOut() },
    ]);
  }

  const version = Constants.expoConfig?.version ?? '1.0.0';

  return (
    <View className="flex-1 bg-neutral-50" style={{ paddingTop: insets.top }}>

      {/* Header */}
      <View className="border-b border-neutral-200 bg-white px-6 pb-4 pt-4">
        <Text className="text-2xl font-bold text-neutral-800">Account</Text>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 32 }}
        showsVerticalScrollIndicator={false}
      >

        {/* Avatar + info */}
        <View className="items-center py-10 gap-3">
          <View
            className="h-20 w-20 items-center justify-center rounded-full bg-coral-500"
            style={{
              shadowColor: '#FF6B5B',
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.25,
              shadowRadius: 10,
              elevation: 6,
            }}
          >
            <Text className="text-2xl font-bold text-white">{initials}</Text>
          </View>
          {name ? (
            <Text className="text-xl font-semibold text-neutral-800">{name}</Text>
          ) : null}
          {email ? (
            <Text className="text-sm text-neutral-500">{email}</Text>
          ) : null}
        </View>

        {/* Actions card */}
        <View
          className="mx-6 overflow-hidden rounded-2xl bg-white"
          style={{
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.06,
            shadowRadius: 8,
            elevation: 2,
          }}
        >
          <Pressable
            onPress={handleSignOut}
            className="flex-row items-center gap-3 px-5 py-4"
            accessibilityRole="button"
            accessibilityLabel="Sign out"
          >
            <Ionicons name="log-out-outline" size={20} color="#EF4444" />
            <Text className="flex-1 text-base font-medium text-red-500">Sign out</Text>
            <Ionicons name="chevron-forward" size={16} color="#D1D5DB" />
          </Pressable>
        </View>

        {/* App version */}
        <Text className="mt-8 text-center text-xs text-neutral-400">
          Rally v{version}
        </Text>

      </ScrollView>
    </View>
  );
}
