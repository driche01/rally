import { getShareUrl } from '../lib/api/trips';

// Isolate pure utility functions — Supabase calls are mocked
jest.mock('../lib/supabase', () => ({
  supabase: {
    from: jest.fn(() => ({
      insert: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: null, error: null }),
      order: jest.fn().mockReturnThis(),
      delete: jest.fn().mockReturnThis(),
    })),
  },
}));

describe('getShareUrl', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('builds a URL from the share token', () => {
    process.env.EXPO_PUBLIC_APP_URL = 'https://rallyapp.io';
    const url = getShareUrl('abc123');
    expect(url).toBe('https://rallyapp.io/respond/abc123');
  });

  it('uses the fallback URL when env var is not set', () => {
    delete process.env.EXPO_PUBLIC_APP_URL;
    const url = getShareUrl('xyz789');
    expect(url).toBe('https://rallyapp.io/respond/xyz789');
  });
});
