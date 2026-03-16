import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getTripUnlockStatus,
  unlockTrip,
  validateDiscountCode,
  redeemDiscountCode,
  type DiscountValidationResult,
} from '@/lib/api/subscriptions';

export const subscriptionKeys = {
  unlockStatus: (tripId: string) => ['subscription', 'unlock', tripId] as const,
};

export function useTripUnlockStatus(tripId: string) {
  return useQuery({
    queryKey: subscriptionKeys.unlockStatus(tripId),
    queryFn: () => getTripUnlockStatus(tripId),
    enabled: !!tripId,
    staleTime: 1000 * 60 * 5, // 5 min — unlock state rarely changes
  });
}

export function useUnlockTrip(tripId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (method: 'iap' | 'code' | 'free') => unlockTrip(tripId, method),
    onSuccess: () => {
      // Invalidate both the unlock status and the full trip (which has phase2_unlocked)
      qc.invalidateQueries({ queryKey: subscriptionKeys.unlockStatus(tripId) });
      qc.invalidateQueries({ queryKey: ['trips', tripId] });
      qc.invalidateQueries({ queryKey: ['trips'] });
    },
  });
}

export function useValidateDiscountCode(tripId: string) {
  return useMutation({
    mutationFn: (code: string) => validateDiscountCode(code, tripId),
  });
}

export function useRedeemDiscountCode(tripId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      codeId,
      discountAppliedCents,
    }: {
      codeId: string;
      discountAppliedCents: number;
    }) => redeemDiscountCode(codeId, tripId, discountAppliedCents),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: subscriptionKeys.unlockStatus(tripId) });
      qc.invalidateQueries({ queryKey: ['trips', tripId] });
    },
  });
}

export type { DiscountValidationResult };
