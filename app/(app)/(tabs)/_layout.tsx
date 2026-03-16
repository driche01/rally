/**
 * Main app tab layout.
 *
 * Persistent bottom nav with two tabs:
 *   - Trips   (home / trips list)
 *   - Account (profile + sign-out)
 *
 * Trip detail screens (hub, edit, recap, etc.) live outside this group in the
 * parent Stack so they push full-screen without the global tab bar.
 * The hub screen retains its own inner 5-tab nav.
 */

import { Ionicons } from '@expo/vector-icons';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Tabs } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// ─── Tab definitions ──────────────────────────────────────────────────────────

const TAB_CONFIG: Record<
  string,
  {
    label: string;
    icon: React.ComponentProps<typeof Ionicons>['name'];
    iconActive: React.ComponentProps<typeof Ionicons>['name'];
  }
> = {
  index:   { label: 'Trips',   icon: 'home-outline',   iconActive: 'home' },
  account: { label: 'Account', icon: 'person-outline', iconActive: 'person' },
};

// ─── Custom tab bar ───────────────────────────────────────────────────────────

function AppTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={{ paddingBottom: insets.bottom }}
      className="border-t border-neutral-200 bg-white"
    >
      <View className="flex-row">
        {state.routes.map((route, index) => {
          const isFocused = state.index === index;
          const tab = TAB_CONFIG[route.name] ?? TAB_CONFIG.index;

          return (
            <Pressable
              key={route.key}
              onPress={() => navigation.navigate(route.name)}
              className="flex-1 items-center py-2"
              accessibilityRole="tab"
              accessibilityState={{ selected: isFocused }}
              accessibilityLabel={tab.label}
            >
              <Ionicons
                name={isFocused ? tab.iconActive : tab.icon}
                size={22}
                color={isFocused ? '#FF6B5B' : '#A8A8A8'}
              />
              <Text
                className={[
                  'mt-0.5 text-[10px]',
                  isFocused ? 'font-semibold text-coral-500' : 'text-neutral-400',
                ].join(' ')}
              >
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// ─── Layout ───────────────────────────────────────────────────────────────────

export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <AppTabBar {...props} />}
      screenOptions={{ headerShown: false }}
    />
  );
}
