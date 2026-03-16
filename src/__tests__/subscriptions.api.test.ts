/**
 * Unit tests for subscriptions.ts
 *
 * Tests cover:
 *   - Product ID / price constants
 *   - validateDiscountCode logic (expired, exhausted, discount math)
 *
 * All Supabase calls are mocked.
 */

// ─── Mock setup ───────────────────────────────────────────────────────────────

const mockSingle = jest.fn();
const mockMaybeSingle = jest.fn();
const mockEq = jest.fn();
const mockFrom = jest.fn();
const mockRpc = jest.fn();
const mockGetUser = jest.fn();

jest.mock('../lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
    auth: { getUser: (...args: unknown[]) => mockGetUser(...args) },
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

import {
  TRIP_UNLOCK_PRODUCT_ID,
  TRIP_UNLOCK_PRICE_CENTS,
  validateDiscountCode,
} from '../lib/api/subscriptions';

// ─── Constants ────────────────────────────────────────────────────────────────

describe('TRIP_UNLOCK constants', () => {
  it('TRIP_UNLOCK_PRODUCT_ID follows Apple/Google bundle ID convention', () => {
    // Bundle IDs use lowercase letters, digits, dots, and underscores
    expect(TRIP_UNLOCK_PRODUCT_ID).toMatch(/^[a-z0-9._]+$/);
    expect(TRIP_UNLOCK_PRODUCT_ID).toContain('trip_unlock');
  });

  it('TRIP_UNLOCK_PRICE_CENTS is $1.99 in cents', () => {
    expect(TRIP_UNLOCK_PRICE_CENTS).toBe(199);
  });
});

// ─── validateDiscountCode ─────────────────────────────────────────────────────

describe('validateDiscountCode', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function mockCodeQuery(data: object | null, error?: { message: string }) {
    mockFrom.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: mockEq.mockReturnThis(),
      single: mockSingle.mockResolvedValue({ data, error: error ?? null }),
      maybeSingle: mockMaybeSingle.mockResolvedValue({ data: null, error: null }),
    });
  }

  it('returns not_found when Supabase returns an error', async () => {
    mockCodeQuery(null, { message: 'Row not found' });
    const result = await validateDiscountCode('BADCODE', 'trip-1');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('not_found');
  });

  it('returns not_found when Supabase returns null data', async () => {
    mockCodeQuery(null);
    const result = await validateDiscountCode('NOCODE', 'trip-1');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('not_found');
  });

  it('returns expired for a code past its expiry date', async () => {
    const code = {
      id: 'code-1',
      code: 'EXPIRED',
      discount_type: 'full',
      discount_value: 100,
      max_uses: 100,
      use_count: 0,
      expires_at: '2020-01-01T00:00:00Z', // well in the past
      is_active: true,
    };
    mockCodeQuery(code);
    const result = await validateDiscountCode('EXPIRED', 'trip-1');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('expired');
  });

  it('returns exhausted when use_count has reached max_uses', async () => {
    const code = {
      id: 'code-2',
      code: 'MAXED',
      discount_type: 'full',
      discount_value: 100,
      max_uses: 5,
      use_count: 5,
      expires_at: null,
      is_active: true,
    };
    mockCodeQuery(code);
    const result = await validateDiscountCode('MAXED', 'trip-1');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('exhausted');
  });

  it('calculates finalPriceCents as 0 for a "full" discount code', async () => {
    const code = {
      id: 'code-3',
      code: 'FREE100',
      discount_type: 'full',
      discount_value: 0,
      max_uses: 100,
      use_count: 0,
      expires_at: null,
      is_active: true,
    };
    // First from() call: fetch the code; second: check for existing redemption
    mockFrom
      .mockReturnValueOnce({
        select: jest.fn().mockReturnThis(),
        eq: mockEq.mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: code, error: null }),
      })
      .mockReturnValueOnce({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
      });

    const result = await validateDiscountCode('FREE100', 'trip-1');
    expect(result.valid).toBe(true);
    expect(result.finalPriceCents).toBe(0);
    expect(result.isFree).toBe(true);
  });

  it('calculates finalPriceCents correctly for a 50% percentage discount', async () => {
    const code = {
      id: 'code-4',
      code: 'HALF50',
      discount_type: 'percentage',
      discount_value: 50, // 50% off
      max_uses: 100,
      use_count: 0,
      expires_at: null,
      is_active: true,
    };
    mockFrom
      .mockReturnValueOnce({
        select: jest.fn().mockReturnThis(),
        eq: mockEq.mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: code, error: null }),
      })
      .mockReturnValueOnce({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
      });

    const result = await validateDiscountCode('HALF50', 'trip-1');
    expect(result.valid).toBe(true);
    // 199 * 50% = ~100 cents off → 99 cents remaining (99.5 rounds to 100, so 199 - 100 = 99)
    expect(result.finalPriceCents).toBe(99);
    expect(result.isFree).toBe(false);
  });

  it('calculates finalPriceCents correctly for a flat discount', async () => {
    const code = {
      id: 'code-5',
      code: 'FLAT50',
      discount_type: 'flat',
      discount_value: 50, // $0.50 off
      max_uses: 100,
      use_count: 0,
      expires_at: null,
      is_active: true,
    };
    mockFrom
      .mockReturnValueOnce({
        select: jest.fn().mockReturnThis(),
        eq: mockEq.mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: code, error: null }),
      })
      .mockReturnValueOnce({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
      });

    const result = await validateDiscountCode('FLAT50', 'trip-1');
    expect(result.valid).toBe(true);
    expect(result.finalPriceCents).toBe(149); // 199 - 50
  });

  it('returns exhausted when the code was already redeemed for this trip', async () => {
    const code = {
      id: 'code-6',
      code: 'ALREADY',
      discount_type: 'full',
      discount_value: 0,
      max_uses: 100,
      use_count: 1,
      expires_at: null,
      is_active: true,
    };
    mockFrom
      .mockReturnValueOnce({
        select: jest.fn().mockReturnThis(),
        eq: mockEq.mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: code, error: null }),
      })
      .mockReturnValueOnce({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        // Existing redemption found
        maybeSingle: jest.fn().mockResolvedValue({ data: { id: 'redemption-1' }, error: null }),
      });

    const result = await validateDiscountCode('ALREADY', 'trip-1');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('exhausted');
  });
});
