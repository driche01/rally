/**
 * Profile setup — first-time onboarding step after signup.
 *
 * Routed to immediately after signup completes (and after the
 * claim-phone path resolves) when the user has no `traveler_profiles`
 * row yet. Mounts the same `TravelerProfileForm` used in the survey
 * flow, but in authenticated mode — saves go through
 * `upsert_my_traveler_profile()` which resolves the row's phone from
 * `auth.uid()` server-side.
 *
 * Save or skip → routes to the home tabs.
 */
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  getMyTravelerProfile,
  upsertMyTravelerProfile,
} from '@/lib/api/travelerProfiles';
import { TravelerProfileForm } from '@/components/respond/TravelerProfileForm';
import type { TravelerProfile } from '@/types/profile';
import { useAuthStore } from '@/stores/authStore';

export default function ProfileSetupScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const user = useAuthStore((s) => s.user);
  const firstName =
    (user?.user_metadata?.name as string | undefined)?.split(/\s+/)[0] ?? null;

  const [loading, setLoading] = useState(true);
  const [initial, setInitial] = useState<TravelerProfile | null>(null);

  useEffect(() => {
    let cancelled = false;
    getMyTravelerProfile()
      .then((p) => {
        if (cancelled) return;
        // Edge case: user has a profile already (e.g., they claimed a
        // phone that was pre-filled via the survey). Skip onboarding —
        // they'll edit via the account tab.
        if (p !== null) {
          router.replace('/(app)/(tabs)');
          return;
        }
        setInitial(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FBF7EF' }}>
        <ActivityIndicator size="large" color="#0F3F2E" />
      </View>
    );
  }

  // paddingTop clears the iOS status bar (no separate header here).
  // The form's sticky footer handles paddingBottom internally.
  return (
    <View style={{ flex: 1, backgroundColor: '#FBF7EF', paddingTop: insets.top }}>
      <TravelerProfileForm
        phone=""
        initialProfile={initial}
        respondentFirstName={firstName}
        onSave={upsertMyTravelerProfile}
        onComplete={() => router.replace('/(app)/(tabs)')}
      />
    </View>
  );
}
