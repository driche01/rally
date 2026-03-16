/**
 * Paywall — F9 Planner Subscription
 *
 * $1.99 one-time unlock per trip via Apple IAP (expo-iap v3).
 * 100% discount codes bypass IAP entirely (server-side unlock).
 * Partial discount codes display the reduced price but still go through IAP.
 */

import { Ionicons } from '@expo/vector-icons';
import {
  useIAP,
  ErrorCode,
  type Purchase,
  type ExpoPurchaseError,
} from 'expo-iap';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTrip } from '@/hooks/useTrips';
import {
  useUnlockTrip,
  useValidateDiscountCode,
  useRedeemDiscountCode,
  type DiscountValidationResult,
} from '@/hooks/useSubscription';
import { TRIP_UNLOCK_PRODUCT_ID, TRIP_UNLOCK_PRICE_CENTS } from '@/lib/api/subscriptions';
import { capture } from '@/lib/analytics';

// ─── Feature list shown on the paywall ───────────────────────────────────────

const FEATURES = [
  { icon: 'calendar-outline' as const,     text: 'Day-by-day itinerary your group can see live' },
  { icon: 'home-outline' as const,          text: 'Search, compare, and vote on where to stay' },
  { icon: 'receipt-outline' as const,       text: 'Expense tracking — no Splitwise tab needed' },
  { icon: 'chatbubble-outline' as const,    text: 'Group updates tied directly to the plan' },
  { icon: 'person-add-outline' as const,    text: 'Group can RSVP by day — no more individual texts' },
];

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function PaywallScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data: trip } = useTrip(id);

  const unlockTrip = useUnlockTrip(id);
  const validateCode = useValidateDiscountCode(id);
  const redeemCode = useRedeemDiscountCode(id);

  const [discountCode, setDiscountCode] = useState('');
  const [codeResult, setCodeResult] = useState<DiscountValidationResult | null>(null);
  const [codeValidating, setCodeValidating] = useState(false);
  const [purchasing, setPurchasing] = useState(false);

  // Fade-in animation
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(opacity, { toValue: 1, duration: 240, useNativeDriver: true }).start();
  }, [opacity]);

  // ── IAP setup (expo-iap v3) ──────────────────────────────────────────────

  // These callbacks are stable refs passed into useIAP so the hook doesn't
  // re-register listeners on every render. We can't call iap.finishTransaction
  // inside handlePurchaseSuccess because `iap` isn't defined yet — instead,
  // we store the purchase in a ref and process it in a separate useEffect.
  const pendingPurchaseRef = useRef<Purchase | null>(null);
  const [pendingPurchase, setPendingPurchase] = useState<Purchase | null>(null);

  const handlePurchaseSuccess = useCallback((purchase: Purchase) => {
    pendingPurchaseRef.current = purchase;
    setPendingPurchase(purchase);
  }, []);

  const handlePurchaseError = useCallback((error: ExpoPurchaseError) => {
    if (error.code !== ErrorCode.UserCancelled) {
      Alert.alert('Purchase failed', error.message ?? 'Please try again.');
    }
    setPurchasing(false);
  }, []);

  const iap = useIAP({
    onPurchaseSuccess: handlePurchaseSuccess,
    onPurchaseError: handlePurchaseError,
  });

  useEffect(() => {
    if (iap.connected) {
      iap.fetchProducts({ skus: [TRIP_UNLOCK_PRODUCT_ID], type: 'in-app' });
    }
  }, [iap.connected]); // eslint-disable-line react-hooks/exhaustive-deps

  // Process a successful purchase: finish the transaction and unlock the trip
  useEffect(() => {
    if (!pendingPurchase) return;
    (async () => {
      try {
        await iap.finishTransaction({ purchase: pendingPurchase, isConsumable: false });
        await unlockTrip.mutateAsync('iap');
        capture('trip_unlocked', { trip_id: id, method: 'iap' });
        router.replace(`/(app)/trips/${id}/hub`);
      } catch {
        Alert.alert('Something went wrong', "Your purchase was recorded but we couldn't unlock the trip. Please contact support.");
        setPurchasing(false);
      }
    })();
  }, [pendingPurchase]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Actions ──────────────────────────────────────────────────────────────────

  async function handlePurchase() {
    if (purchasing || !iap.connected) return;
    setPurchasing(true);
    try {
      await iap.requestPurchase({
        request: {
          apple: { sku: TRIP_UNLOCK_PRODUCT_ID },
          google: { skus: [TRIP_UNLOCK_PRODUCT_ID] },
        },
        type: 'in-app',
      });
      // finishTransaction + unlock handled in onPurchaseSuccess callback above
    } catch (err: unknown) {
      const purchaseErr = err as ExpoPurchaseError;
      if (purchaseErr?.code !== ErrorCode.UserCancelled) {
        Alert.alert('Purchase failed', purchaseErr?.message ?? 'Please try again.');
      }
      setPurchasing(false);
    }
  }

  async function handleValidateCode() {
    const trimmed = discountCode.trim().toUpperCase();
    if (!trimmed) return;
    setCodeValidating(true);
    setCodeResult(null);
    try {
      const result = await validateCode.mutateAsync(trimmed);
      setCodeResult(result);
    } finally {
      setCodeValidating(false);
    }
  }

  async function handleApplyFreeCode() {
    if (!codeResult?.valid || !codeResult.isFree || !codeResult.code) return;
    setPurchasing(true);
    try {
      await redeemCode.mutateAsync({
        codeId: codeResult.code.id,
        discountAppliedCents: TRIP_UNLOCK_PRICE_CENTS,
      });
      await unlockTrip.mutateAsync('code');
      capture('trip_unlocked', { trip_id: id, method: 'code' });
      router.replace(`/(app)/trips/${id}/hub`);
    } catch {
      Alert.alert('Error', 'Could not apply code. Please try again.');
    } finally {
      setPurchasing(false);
    }
  }

  // ── Derived state ─────────────────────────────────────────────────────────

  const product = iap.products?.[0];
  // expo-iap v3: both iOS and Android products expose `displayPrice`
  const displayPrice = product?.displayPrice ?? '$1.99';

  const codeErrorMessage: Record<string, string> = {
    not_found: 'Code not found.',
    expired: 'This code has expired.',
    exhausted: 'This code has already been used.',
    inactive: 'This code is no longer active.',
  };

  const activeCTAPrice = codeResult?.valid
    ? codeResult.isFree
      ? 'Free'
      : `$${((codeResult.finalPriceCents ?? TRIP_UNLOCK_PRICE_CENTS) / 100).toFixed(2)}`
    : displayPrice;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <Animated.View className="flex-1 bg-neutral-50" style={{ opacity, paddingTop: insets.top }}>

      {/* Header */}
      <View className="flex-row items-center px-6 pb-3 pt-4">
        <Pressable onPress={() => router.back()} accessibilityRole="button">
          <Ionicons name="close" size={24} color="#A8A8A8" />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: insets.bottom + 32 }}
        showsVerticalScrollIndicator={false}
      >

        {/* Hero */}
        <View className="items-center py-6">
          <View
            style={{
              width: 64,
              height: 64,
              borderRadius: 18,
              backgroundColor: '#FF6B5B',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 16,
              shadowColor: '#FF6B5B',
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.3,
              shadowRadius: 8,
              elevation: 8,
            }}
          >
            <Text style={{ fontSize: 28 }}>🏔️</Text>
          </View>
          <Text className="mb-2 text-2xl font-bold text-neutral-800 text-center">
            Rally Trip
          </Text>
          <Text className="text-center text-base text-neutral-500 leading-6 max-w-xs">
            Replaces your group chat, your Google Sheet, and your Splitwise tab — for one trip.
          </Text>
        </View>

        {/* Features */}
        <View
          className="mb-6 rounded-2xl bg-white px-5 py-4 gap-4"
          style={{ shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2 }}
        >
          {FEATURES.map(({ icon, text }) => (
            <View key={text} className="flex-row items-center gap-3">
              <View
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 10,
                  backgroundColor: '#FFF4F2',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <Ionicons name={icon} size={16} color="#FF6B5B" />
              </View>
              <Text className="flex-1 text-sm text-neutral-700">{text}</Text>
              <Ionicons name="checkmark" size={16} color="#22C55E" />
            </View>
          ))}
        </View>

        {/* Price + CTA */}
        <View className="mb-5 gap-3">
          <Pressable
            onPress={codeResult?.valid && codeResult.isFree ? handleApplyFreeCode : handlePurchase}
            disabled={purchasing || !iap.connected}
            className="items-center justify-center rounded-2xl bg-coral-500 py-4"
            style={{
              opacity: purchasing || !iap.connected ? 0.7 : 1,
              shadowColor: '#FF6B5B',
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.3,
              shadowRadius: 8,
              elevation: 6,
            }}
            accessibilityRole="button"
          >
            {purchasing ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text className="text-base font-bold text-white">
                {codeResult?.valid && codeResult.isFree
                  ? 'Unlock for free →'
                  : `Unlock this trip — ${activeCTAPrice}`}
              </Text>
            )}
          </Pressable>

          <Text className="text-center text-xs text-neutral-400">
            One-time payment · No subscription · Access never expires
          </Text>
        </View>

        {/* Discount code */}
        <View
          className="rounded-2xl bg-white px-4 py-4 gap-3"
          style={{ shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 }}
        >
          <Text className="text-sm font-semibold text-neutral-700">Have a discount code?</Text>
          <View className="flex-row items-center gap-2">
            <TextInput
              value={discountCode}
              onChangeText={(t) => {
                setDiscountCode(t.toUpperCase());
                setCodeResult(null);
              }}
              placeholder="ENTER CODE"
              autoCapitalize="characters"
              autoCorrect={false}
              className="flex-1 rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2.5 text-sm font-medium text-neutral-800"
              style={{ letterSpacing: 1.5 }}
            />
            <Pressable
              onPress={handleValidateCode}
              disabled={!discountCode.trim() || codeValidating}
              className="rounded-xl bg-neutral-800 px-4 py-2.5"
              style={{ opacity: !discountCode.trim() || codeValidating ? 0.4 : 1 }}
            >
              {codeValidating
                ? <ActivityIndicator size="small" color="white" />
                : <Text className="text-sm font-semibold text-white">Apply</Text>
              }
            </Pressable>
          </View>

          {/* Code feedback */}
          {codeResult && (
            <View
              className={[
                'rounded-xl px-3 py-2',
                codeResult.valid ? 'bg-green-50' : 'bg-red-50',
              ].join(' ')}
            >
              {codeResult.valid ? (
                <Text className="text-sm font-medium text-green-700">
                  {codeResult.isFree
                    ? '✓ 100% off — unlock for free'
                    : `✓ Code applied — ${activeCTAPrice} (was ${displayPrice})`}
                </Text>
              ) : (
                <Text className="text-sm font-medium text-red-600">
                  {codeErrorMessage[codeResult.error ?? ''] ?? 'Invalid code.'}
                </Text>
              )}
            </View>
          )}
        </View>

        {/* Phase 1 stays free */}
        <Text className="mt-5 text-center text-xs text-neutral-400 leading-5 px-4">
          Polls and the group share link remain free forever.{'\n'}
          Only itinerary, lodging, expenses, and chat require Rally Trip.
        </Text>

      </ScrollView>
    </Animated.View>
  );
}
