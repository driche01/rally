/**
 * Travel preferences — authenticated edit screen.
 *
 * Reached from the Account tab's "Travel preferences" row. Loads the
 * current user's profile via `getMyTravelerProfile()` and mounts the
 * shared `TravelerProfileForm` in edit mode. Save → routes back.
 *
 * No "Welcome back" framing here — that's reserved for the survey
 * flow where it lands as a contextual greeting. Account-tab edit gets
 * a neutral "Travel preferences" header.
 */
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  getMyTravelerProfile,
  upsertMyTravelerProfile,
} from '@/lib/api/travelerProfiles';
import { TravelerProfileForm } from '@/components/respond/TravelerProfileForm';
import type { TravelerProfile } from '@/types/profile';

export default function ProfilePrefsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [initial, setInitial] = useState<TravelerProfile | null>(null);

  useEffect(() => {
    let cancelled = false;
    getMyTravelerProfile()
      .then((p) => {
        if (!cancelled) setInitial(p);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FBF7EF' }}>
        <ActivityIndicator size="large" color="#0F3F2E" />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#FBF7EF', paddingTop: insets.top }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: 16,
          paddingVertical: 12,
        }}
      >
        <Pressable
          onPress={() => router.back()}
          hitSlop={8}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Ionicons name="chevron-back" size={20} color="#0F3F2E" />
          <Text style={{ fontSize: 16, color: '#0F3F2E' }}>Back</Text>
        </Pressable>
        <View style={{ width: 60 }} />
      </View>

      {/* `flex: 1` wrapper — without this, the ScrollView at the root
          of TravelerProfileForm grows to its content's natural height
          and gets clipped by the screen edge, making the Continue
          button (and Page B with Activities/Budget/Notes) unreachable. */}
      <View style={{ flex: 1 }}>
        <TravelerProfileForm
          phone=""
          initialProfile={initial}
          onSave={upsertMyTravelerProfile}
          onComplete={() => router.back()}
          introTitleOverride="Travel preferences"
          introSubtitleOverride={
            initial
              ? "Update anything that's changed. Your group sees these on every trip."
              : "Tell us about you. Your group sees these on every trip."
          }
        />
      </View>
    </View>
  );
}
