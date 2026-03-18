import { supabase } from '../supabase';
import type { DiscountCode, DiscountCodeRedemption } from '../../types/database';

// IAP product ID registered in App Store Connect
export const TRIP_UNLOCK_PRODUCT_ID = 'io.rallyapp.app.trip_unlock';
// Price in cents (used for display + partial discount calculation)
export const TRIP_UNLOCK_PRICE_CENTS = 199;

// ─── Unlock state ─────────────────────────────────────────────────────────────

export async function getTripUnlockStatus(tripId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('trips')
    .select('phase2_unlocked')
    .eq('id', tripId)
    .single();
  if (error) throw error;
  return data?.phase2_unlocked ?? false;
}

/**
 * Server-side unlock — sets phase2_unlocked on the trip row.
 * Called after successful IAP verification or 100% discount code redemption.
 */
export async function unlockTrip(
  tripId: string,
  method: 'iap' | 'code' | 'free'
): Promise<void> {
  const { error } = await supabase
    .from('trips')
    .update({
      phase2_unlocked: true,
      phase2_unlocked_at: new Date().toISOString(),
      phase2_unlock_method: method,
    })
    .eq('id', tripId);
  if (error) throw error;
}

// ─── Discount codes ───────────────────────────────────────────────────────────

export interface DiscountValidationResult {
  valid: boolean;
  code?: DiscountCode;
  error?: 'not_found' | 'expired' | 'exhausted' | 'inactive';
  /** Discounted price in cents (0 for full, reduced for % or flat) */
  finalPriceCents?: number;
  /** True when finalPriceCents === 0 — IAP is bypassed */
  isFree?: boolean;
}

export async function validateDiscountCode(
  code: string,
  tripId: string
): Promise<DiscountValidationResult> {
  const upperCode = code.trim().toUpperCase();

  // Fetch the code
  const { data, error } = await supabase
    .from('discount_codes')
    .select('*')
    .eq('code', upperCode)
    .eq('is_active', true)
    .single();

  if (error || !data) {
    return { valid: false, error: 'not_found' };
  }

  // Check expiry
  if (data.expires_at && new Date(data.expires_at) < new Date()) {
    return { valid: false, error: 'expired' };
  }

  // Check use limit
  if (data.use_count >= data.max_uses) {
    return { valid: false, error: 'exhausted' };
  }

  // Check if already redeemed for this trip
  const { data: existing } = await supabase
    .from('discount_code_redemptions')
    .select('id')
    .eq('code_id', data.id)
    .eq('trip_id', tripId)
    .maybeSingle();

  if (existing) {
    return { valid: false, error: 'exhausted' };
  }

  // Calculate final price
  let finalPriceCents = TRIP_UNLOCK_PRICE_CENTS;
  if (data.discount_type === 'full') {
    finalPriceCents = 0;
  } else if (data.discount_type === 'percentage') {
    const discount = Math.round((TRIP_UNLOCK_PRICE_CENTS * data.discount_value) / 100);
    finalPriceCents = Math.max(0, TRIP_UNLOCK_PRICE_CENTS - discount);
  } else if (data.discount_type === 'flat') {
    finalPriceCents = Math.max(0, TRIP_UNLOCK_PRICE_CENTS - data.discount_value);
  }

  return {
    valid: true,
    code: data,
    finalPriceCents,
    isFree: finalPriceCents === 0,
  };
}

export async function redeemDiscountCode(
  codeId: string,
  tripId: string,
  discountAppliedCents: number
): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  // Insert redemption record (this fails on duplicate due to unique constraint)
  const { error: redemptionError } = await supabase
    .from('discount_code_redemptions')
    .insert({
      code_id: codeId,
      planner_id: user.id,
      trip_id: tripId,
      discount_applied_cents: discountAppliedCents,
    });
  if (redemptionError) throw redemptionError;

  // Increment use_count
  const { error: countError } = await supabase.rpc('increment_discount_code_use_count', {
    p_code_id: codeId,
  });
  // Non-fatal if rpc doesn't exist yet — increment via update
  if (countError) {
    try {
      await supabase.rpc('increment_column', {
        table_name: 'discount_codes',
        column_name: 'use_count',
        row_id: codeId,
      });
    } catch { /* best-effort */ }
  }
}

export type { DiscountCodeRedemption };
