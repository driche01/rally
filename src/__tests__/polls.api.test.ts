/**
 * Tests for pure logic in the poll API helpers.
 * Supabase client is mocked — these tests validate data-shaping only.
 */

// Mock Supabase before any imports
jest.mock('../lib/supabase', () => ({
  supabase: {
    from: jest.fn(() => ({
      insert: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      delete: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: null, error: null }),
    })),
  },
}));

import { BUDGET_TIERS } from '../types/database';

describe('BUDGET_TIERS', () => {
  it('has exactly 4 tiers', () => {
    expect(BUDGET_TIERS).toHaveLength(4);
  });

  it('has unique IDs', () => {
    const ids = BUDGET_TIERS.map((t) => t.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('tiers are ordered from low to high', () => {
    expect(BUDGET_TIERS[0].label).toMatch(/500/);
    expect(BUDGET_TIERS[3].label).toMatch(/2,000/);
  });
});
