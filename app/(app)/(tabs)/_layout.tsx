/**
 * Main app tab layout.
 *
 * Persistent bottom nav with two tabs:
 *   - Trips   (home / trips list)
 *   - Account (profile + sign-out)
 *
 * Trip detail screens (hub, edit, recap, etc.) live outside this group in the
 * parent Stack so they push full-screen without the global tab bar.
 * The hub screen retains its own inner tab nav (Polls | Itinerary | Lodging | Travel | Expenses).
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
  index:   { label: 'Trips',   icon: 'home-outline',   iconActive: 'home' },
  account: { label: 'Account', icon: 'person-outline', iconActive: 'person' },
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
        // justifyContent: center vertically centers the icon at the row's
        // vertical midpoint. The label hangs off via `position: absolute`
        // so it doesn't pull the icon centroid upward.
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
        accessibilityRole="tab"
        accessibilityState={{ selected: isFocused }}
        accessibilityLabel={tab.label}
      >
        <Ionicons
          name={isFocused ? tab.iconActive : tab.icon}
          size={22}
          color={isFocused ? '#0F3F2E' : '#9DA8A0'}
        />
        <Text
          style={{
            position: 'absolute',
            bottom: 4,
            fontSize: 10,
            fontWeight: isFocused ? '600' : '400',
            color: isFocused ? '#0F3F2E' : '#9DA8A0',
          }}
        >
          {tab.label}
        </Text>
      </Pressable>
    );
  }

  return (
    <View style={{ paddingBottom: insets.bottom, borderTopWidth: 1, borderTopColor: '#E7DDCF', backgroundColor: '#FFFAF2' }}>
      {/* Explicit row height + justifyContent: center on each cell puts
          every icon (and the + button) at y = ROW_HEIGHT/2 — the row's
          vertical center. Tab labels sit absolutely below the icons via
          `bottom: 4` and don't affect the icon centering math. */}
      <View style={{ flexDirection: 'row', height: 60 }}>
        {leftRoutes.map((route, i) => renderTab(route, i))}

        {/* Center + button — vertically centered the same way. */}
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Pressable
            onPress={() => router.push('/(app)/trips/new')}
            style={{
              width: 36,
              height: 36,
              borderRadius: 18,
              backgroundColor: '#0F3F2E',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            accessibilityRole="button"
            accessibilityLabel="Add a trip"
          >
            <Ionicons name="add" size={22} color="white" />
          </Pressable>
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
