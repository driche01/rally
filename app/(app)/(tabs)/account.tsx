/**
 * Account screen — profile info, sign-out, and app version.
 */

import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSignOut } from '@/hooks/useAuth';
import { useMyProfile, profileKeys } from '@/hooks/useProfile';
import { useAuthStore } from '@/stores/authStore';
import { supabase } from '@/lib/supabase';
import { removeMyAvatar, uploadMyAvatar } from '@/lib/api/profile';
import { useQueryClient } from '@tanstack/react-query';
import {
  EditNameModal,
  EditEmailModal,
  EditPhoneModal,
  EditPasswordModal,
} from '@/components/account/AccountFieldModals';

export default function AccountScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuthStore();
  const signOut = useSignOut();
  const { data: profile } = useMyProfile();
  const qc = useQueryClient();

  const [editing, setEditing] = useState<'name' | 'email' | 'phone' | 'password' | null>(null);
  const refetchProfile = () => qc.invalidateQueries({ queryKey: profileKeys.me() });

  // Phase 6: detect users with phone history (SMS or survey) that hasn't yet
  // been claimed by their auth account, and surface a "Link your phone" CTA.
  // Only renders when the RPC returns true. Silent for users without a phone.
  const [claimable, setClaimable] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const phone = (profile as { phone?: string | null })?.phone;
    if (!phone) { setClaimable(false); return; }
    (async () => {
      const { data } = await supabase.rpc('check_claim_available', { p_phone: phone });
      if (!cancelled) setClaimable(data === true);
    })();
    return () => { cancelled = true; };
  }, [(profile as { phone?: string | null })?.phone]);

  async function handleClaimPhone() {
    const phone = (profile as { phone?: string | null })?.phone;
    if (!phone) return;
    try {
      await fetch(`${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/claim-otp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? ''}`,
        },
        body: JSON.stringify({ phone }),
      });
    } catch { /* claim screen has Resend */ }
    router.push({
      pathname: '/(auth)/claim-phone' as Parameters<typeof router.push>[0] extends string ? string : never,
      params: { phone },
    } as unknown as Parameters<typeof router.push>[0]);
  }

  const name = user?.user_metadata?.name as string | undefined;
  const email = user?.email;
  const avatarUrl = (profile as { avatar_url?: string | null } | null)?.avatar_url ?? null;

  // Build initials from name if available, otherwise fall back to first letter of email
  const initials = name
    ? name
        .split(' ')
        .map((w) => w[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)
    : (email?.[0]?.toUpperCase() ?? '?');

  // ─── Avatar upload / remove ─────────────────────────────────────────────
  // Tap the circle → action sheet. Photo library + camera both go through
  // expo-image-picker's permission flow; "Remove" only shown when one is set.
  const [avatarBusy, setAvatarBusy] = useState(false);

  async function pickAndUpload(source: 'library' | 'camera') {
    // Lazy-require expo-image-picker so older binaries (TestFlight builds /
    // dev clients) that don't have the native module compiled in still let
    // the rest of the screen render. We tell the user to update the app
    // when either the JS package can't load OR the native module behind
    // it is absent at call time (manifests as "Cannot read property
    // 'request...PermissionsAsync' of undefined" because the package's
    // proxy to the native module reads undefined).
    let ImagePicker: typeof import('expo-image-picker');
    try {
      ImagePicker = require('expo-image-picker') as typeof import('expo-image-picker');
    } catch {
      promptUpdateApp();
      return;
    }

    try {
      const perm = source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          source === 'camera' ? 'Camera permission needed' : 'Photo access needed',
          source === 'camera'
            ? 'Enable camera access in Settings to take a profile picture.'
            : 'Enable photo access in Settings to choose a profile picture.',
        );
        return;
      }
      const result = source === 'camera'
        ? await ImagePicker.launchCameraAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            allowsEditing: true,
            aspect: [1, 1],
            quality: 0.85,
          })
        : await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            allowsEditing: true,
            aspect: [1, 1],
            quality: 0.85,
          });
      if (result.canceled || !result.assets?.[0]?.uri) return;

      setAvatarBusy(true);
      await uploadMyAvatar(result.assets[0].uri);
      refetchProfile();
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (isNativeModuleMissingError(msg)) {
        promptUpdateApp();
        return;
      }
      Alert.alert('Could not update photo', msg || 'Try again.');
    } finally {
      setAvatarBusy(false);
    }
  }

  function isNativeModuleMissingError(msg: string): boolean {
    // The expo-image-picker JS package proxies into a native module named
    // `ExponentImagePicker`. When that module isn't in the binary, the
    // proxy reads as undefined and any call surfaces as "Cannot read
    // property '<fn>PermissionsAsync' of undefined" or similar.
    return /undefined/i.test(msg) && /(Permissions?Async|Launch.+Async|ExponentImagePicker)/i.test(msg);
  }

  function promptUpdateApp() {
    Alert.alert(
      'Update Rally to upload a photo',
      'Profile photos need the latest app build. Update from TestFlight (or wait for the next release) and try again.',
    );
  }

  async function doRemoveAvatar() {
    try {
      setAvatarBusy(true);
      await removeMyAvatar();
      refetchProfile();
    } catch (err) {
      Alert.alert('Could not remove photo', err instanceof Error ? err.message : 'Try again.');
    } finally {
      setAvatarBusy(false);
    }
  }

  function handleAvatarPress() {
    if (avatarBusy) return;
    const buttons: Array<{ text: string; style?: 'cancel' | 'destructive'; onPress?: () => void }> = [
      { text: 'Choose from Library', onPress: () => pickAndUpload('library') },
      { text: 'Take Photo', onPress: () => pickAndUpload('camera') },
    ];
    if (avatarUrl) {
      buttons.push({ text: 'Remove Photo', style: 'destructive', onPress: doRemoveAvatar });
    }
    buttons.push({ text: 'Cancel', style: 'cancel' });
    Alert.alert('Profile photo', undefined, buttons);
  }

  function handleSignOut() {
    Alert.alert('Sign out?', "You'll need to sign back in to access your trips.", [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => signOut() },
    ]);
  }

  const [deleting, setDeleting] = useState(false);

  function handleDeleteAccount() {
    Alert.alert(
      'Delete your account?',
      'This permanently deletes your trips, polls, group history, and sign-in. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          style: 'destructive',
          onPress: () => {
            // Second confirmation so a single tap can't end the account.
            Alert.alert(
              'Are you sure?',
              'Tap Delete to permanently remove your Rally account and all of its data.',
              [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Delete', style: 'destructive', onPress: () => doDeleteAccount() },
              ],
            );
          },
        },
      ],
    );
  }

  async function doDeleteAccount() {
    if (deleting) return;
    setDeleting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        Alert.alert('Could not delete', 'You appear to be signed out. Sign in and try again.');
        return;
      }
      const url = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/delete-account`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });
      const json = (await res.json().catch(() => null)) as {
        ok?: boolean; reason?: string; detail?: string;
      } | null;
      if (!json?.ok) {
        // Surface the SQL detail when the edge function passes one back —
        // without it, "cleanup_failed" alone gives no clue which step
        // tripped a constraint, leaving us guessing at root cause.
        const message = json?.detail
          ? `${json.reason ?? 'Error'} — ${json.detail}`
          : json?.reason ?? 'Try again.';
        Alert.alert('Could not delete', message);
        return;
      }
      // Account deleted server-side. Sign out locally to clear cached state
      // and route the user back to the auth stack.
      await signOut();
    } catch {
      Alert.alert('Could not delete', 'Network error. Try again.');
    } finally {
      setDeleting(false);
    }
  }

  const version = Constants.expoConfig?.version ?? '1.0.0';

  return (
    <View className="flex-1 bg-cream" style={{ paddingTop: insets.top }}>

      {/* Header */}
      <View className="border-b border-line bg-card px-6 pb-4 pt-4">
        <Text className="text-2xl font-bold text-ink">Account</Text>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 12 }}
        showsVerticalScrollIndicator={false}
      >

        {/* Avatar — tap the circle to upload, replace, or remove. Name +
            email are duplicated in the form rows below, so we omit them
            here to keep everything on a single screen. */}
        <View className="items-center pt-4 pb-6">
          <Pressable
            onPress={handleAvatarPress}
            disabled={avatarBusy}
            accessibilityRole="button"
            accessibilityLabel={avatarUrl ? 'Change profile photo' : 'Add profile photo'}
            accessibilityState={{ busy: avatarBusy }}
            style={{
              width: 76,
              height: 76,
              borderRadius: 38,
              shadowColor: '#0F3F2E',
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.25,
              shadowRadius: 10,
              elevation: 6,
            }}
          >
            <View
              style={{
                width: 76,
                height: 76,
                borderRadius: 38,
                overflow: 'hidden',
                backgroundColor: '#0F3F2E',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {avatarUrl ? (
                <Image
                  source={{ uri: avatarUrl }}
                  style={{ width: 76, height: 76 }}
                />
              ) : (
                <Text className="text-xl font-bold text-white">{initials}</Text>
              )}
              {avatarBusy ? (
                <View
                  style={{
                    position: 'absolute',
                    inset: 0,
                    backgroundColor: 'rgba(0,0,0,0.35)',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <ActivityIndicator color="#FFFFFF" />
                </View>
              ) : null}
            </View>
            {/* Camera badge — small affordance so the circle reads as tappable. */}
            <View
              style={{
                position: 'absolute',
                right: -2,
                bottom: -2,
                width: 26,
                height: 26,
                borderRadius: 13,
                backgroundColor: '#FFFFFF',
                borderWidth: 2,
                borderColor: '#FBF7EF',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name="camera" size={14} color="#0F3F2E" />
            </View>
          </Pressable>
        </View>

        {/* Profile card — editable name / email / phone / password.
            Email + phone changes route through Supabase verification
            (link or OTP); password requires the current password. */}
        <View
          className="mx-6 mb-3 overflow-hidden rounded-2xl bg-card"
          style={{
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.06,
            shadowRadius: 8,
            elevation: 2,
          }}
        >
          <Pressable
            onPress={() => setEditing('name')}
            className="flex-row items-center gap-3 border-b border-line px-5 py-3"
            accessibilityRole="button"
          >
            <Ionicons name="person-outline" size={20} color="#5F685F" />
            <View className="flex-1">
              <Text className="text-xs uppercase font-semibold text-muted" style={{ letterSpacing: 0.6 }}>Name</Text>
              <Text className="text-base text-ink mt-0.5" numberOfLines={1}>
                {(profile as { name?: string | null; last_name?: string | null } | null)?.name
                  ? [(profile as { name?: string | null }).name, (profile as { last_name?: string | null }).last_name].filter(Boolean).join(' ')
                  : (name ?? 'Add your name')}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color="#D1D5DB" />
          </Pressable>

          <Pressable
            onPress={() => setEditing('email')}
            className="flex-row items-center gap-3 border-b border-line px-5 py-3"
            accessibilityRole="button"
          >
            <Ionicons name="mail-outline" size={20} color="#5F685F" />
            <View className="flex-1">
              <Text className="text-xs uppercase font-semibold text-muted" style={{ letterSpacing: 0.6 }}>Email</Text>
              <Text className="text-base text-ink mt-0.5" numberOfLines={1}>{email ?? '—'}</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color="#D1D5DB" />
          </Pressable>

          <Pressable
            onPress={() => setEditing('phone')}
            className="flex-row items-center gap-3 border-b border-line px-5 py-3"
            accessibilityRole="button"
          >
            <Ionicons name="call-outline" size={20} color="#5F685F" />
            <View className="flex-1">
              <Text className="text-xs uppercase font-semibold text-muted" style={{ letterSpacing: 0.6 }}>Phone</Text>
              <Text className="text-base text-ink mt-0.5" numberOfLines={1}>
                {(profile as { phone?: string | null } | null)?.phone ?? 'Add a phone'}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color="#D1D5DB" />
          </Pressable>

          <Pressable
            onPress={() => setEditing('password')}
            className="flex-row items-center gap-3 px-5 py-3"
            accessibilityRole="button"
          >
            <Ionicons name="lock-closed-outline" size={20} color="#5F685F" />
            <View className="flex-1">
              <Text className="text-xs uppercase font-semibold text-muted" style={{ letterSpacing: 0.6 }}>Password</Text>
              <Text className="text-base text-ink mt-0.5">••••••••</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color="#D1D5DB" />
          </Pressable>
        </View>

        {/* Actions card */}
        <View
          className="mx-6 overflow-hidden rounded-2xl bg-card"
          style={{
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.06,
            shadowRadius: 8,
            elevation: 2,
          }}
        >
          {claimable ? (
            <Pressable
              onPress={handleClaimPhone}
              className="flex-row items-center gap-3 border-b border-line px-5 py-3"
              accessibilityRole="button"
              accessibilityLabel="Link your phone history"
            >
              <Ionicons name="phone-portrait-outline" size={20} color="#1D9E75" />
              <View className="flex-1">
                <Text className="text-base font-medium text-ink">Link your phone history</Text>
                <Text className="text-sm text-muted">
                  We found trips your phone is part of — tap to link them to this account.
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color="#D1D5DB" />
            </Pressable>
          ) : null}

          <Pressable
            onPress={() => router.push('/(app)/profile-prefs')}
            className="flex-row items-center gap-3 border-b border-line px-5 py-3"
            accessibilityRole="button"
            accessibilityLabel="Travel preferences"
          >
            <Ionicons name="person-circle-outline" size={20} color="#0F3F2E" />
            <View className="flex-1">
              <Text className="text-base font-medium text-ink">Travel preferences</Text>
              <Text className="text-sm text-muted">
                Your home airport, dietary needs, pace, and more.
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color="#D1D5DB" />
          </Pressable>

          <Pressable
            onPress={handleSignOut}
            className="flex-row items-center gap-3 border-b border-line px-5 py-3"
            accessibilityRole="button"
            accessibilityLabel="Sign out"
          >
            <Ionicons name="log-out-outline" size={20} color="#EF4444" />
            <Text className="flex-1 text-base font-medium text-red-500">Sign out</Text>
            <Ionicons name="chevron-forward" size={16} color="#D1D5DB" />
          </Pressable>

          <Pressable
            onPress={handleDeleteAccount}
            disabled={deleting}
            className="flex-row items-center gap-3 px-5 py-3"
            accessibilityRole="button"
            accessibilityLabel="Delete account"
            accessibilityState={{ busy: deleting }}
          >
            <Ionicons name="trash-outline" size={20} color="#B91C1C" />
            <Text className="flex-1 text-base font-medium text-red-700">
              {deleting ? 'Deleting account…' : 'Delete account'}
            </Text>
            <Ionicons name="chevron-forward" size={16} color="#D1D5DB" />
          </Pressable>
        </View>

        {/* App version */}
        <Text className="mt-3 text-center text-xs text-muted">
          Rally v{version}
        </Text>

      </ScrollView>

      {/* Edit modals — mounted at root, controlled via `editing` state. */}
      <EditNameModal
        visible={editing === 'name'}
        onClose={() => setEditing(null)}
        onSaved={refetchProfile}
        initialName={
          (profile as { name?: string | null; last_name?: string | null } | null)?.name
            ? [(profile as { name?: string | null }).name, (profile as { last_name?: string | null }).last_name].filter(Boolean).join(' ')
            : name ?? null
        }
      />
      <EditEmailModal
        visible={editing === 'email'}
        onClose={() => setEditing(null)}
        onSaved={refetchProfile}
        initialEmail={email ?? null}
      />
      <EditPhoneModal
        visible={editing === 'phone'}
        onClose={() => setEditing(null)}
        onSaved={refetchProfile}
        initialPhone={(profile as { phone?: string | null } | null)?.phone ?? null}
      />
      <EditPasswordModal
        visible={editing === 'password'}
        onClose={() => setEditing(null)}
        onSaved={() => { /* no profile refetch needed for password */ }}
        email={email ?? null}
      />
    </View>
  );
}
