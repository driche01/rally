import {
  getParticipationRate,
  GROUP_SIZE_MIDPOINTS,
  type GroupSizeBucket,
} from '../types/database';

describe('getParticipationRate', () => {
  it('returns 0% when no respondents', () => {
    const result = getParticipationRate(0, '5-8');
    expect(result.count).toBe(0);
    expect(result.total).toBe(8); // max for 5-8
    expect(result.percent).toBe(0);
  });

  it('uses the correct max values per bucket', () => {
    const buckets: GroupSizeBucket[] = ['0-4', '5-8', '9-12', '13-20', '20+'];
    const expected = [4, 8, 12, 20, 20];
    buckets.forEach((bucket, i) => {
      expect(GROUP_SIZE_MIDPOINTS[bucket]).toBe(expected[i]);
    });
  });

  it('calculates percent correctly', () => {
    const result = getParticipationRate(4, '5-8'); // 4/8
    expect(result.count).toBe(4);
    expect(result.total).toBe(8);
    expect(result.percent).toBe(50); // Math.round(4/8*100) = 50
  });

  it('caps at 100% for over-participation', () => {
    const result = getParticipationRate(25, '20+'); // 25/20 = 125% → capped at 100
    expect(result.percent).toBe(100);
  });

  it('handles 9-12 bucket', () => {
    const result = getParticipationRate(7, '9-12');
    expect(result.total).toBe(12);
    expect(result.percent).toBe(58); // Math.round(7/12*100) = 58
  });
});
