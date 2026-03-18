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
import { Tabs, useRouter } from 'expo-router';
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
  index:   { label: 'Trips',   icon: 'home-outline',        iconActive: 'home' },
  chat:    { label: 'Chat',    icon: 'chatbubble-outline',  iconActive: 'chatbubble' },
  account: { label: 'Account', icon: 'person-outline',      iconActive: 'person' },
};

// ─── Custom tab bar ───────────────────────────────────────────────────────────

function AppTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  // Split routes into left and right of the center + button
  const routes = state.routes;
  const mid = Math.ceil(routes.length / 2);
  const leftRoutes = routes.slice(0, mid);
  const rightRoutes = routes.slice(mid);

  function renderTab(route: (typeof routes)[number], index: number) {
    const isFocused = state.index === index;
    const tab = TAB_CONFIG[route.name] ?? TAB_CONFIG.index;

    return (
      <Pressable
        key={route.key}
        onPress={() => navigation.navigate(route.name)}
        style={{ flex: 1, alignItems: 'center', paddingVertical: 8 }}
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
          style={{
            marginTop: 2,
            fontSize: 10,
            fontWeight: isFocused ? '600' : '400',
            color: isFocused ? '#FF6B5B' : '#A8A8A8',
          }}
        >
          {tab.label}
        </Text>
      </Pressable>
    );
  }

  return (
    <View style={{ paddingBottom: insets.bottom, borderTopWidth: 1, borderTopColor: '#E5E5E5', backgroundColor: '#fff' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        {leftRoutes.map((route, i) => renderTab(route, i))}

        {/* Center + button */}
        <View style={{ flex: 1, alignItems: 'center', paddingVertical: 8 }}>
          <Pressable
            onPress={() => router.push('/(app)/trips/new')}
            style={{
              width: 36,
              height: 36,
              borderRadius: 18,
              backgroundColor: '#FF6B5B',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            accessibilityRole="button"
            accessibilityLabel="Add a rally"
          >
            <Ionicons name="add" size={22} color="white" />
          </Pressable>
          <Text style={{ marginTop: 2, fontSize: 10, color: '#A8A8A8' }}> </Text>
        </View>

        {rightRoutes.map((route, i) => renderTab(route, mid + i))}
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
