/**
 * Unit tests for pure utility functions in expenses.ts
 * (equalSplitCents, validateSplits, computeBalances, exportExpensesCsv, buildVenmoLink)
 *
 * Supabase is mocked — no network calls are made.
 */

jest.mock('../lib/supabase', () => ({
  supabase: {
    from: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      delete: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: null, error: null }),
    })),
  },
}));

import {
  equalSplitCents,
  validateSplits,
  computeBalances,
  exportExpensesCsv,
  buildVenmoLink,
  type SplitInput,
} from '../lib/api/expenses';
import type { ExpenseWithSplits, Respondent, Profile } from '../types/database';

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeExpense(overrides: Partial<ExpenseWithSplits> = {}): ExpenseWithSplits {
  return {
    id: 'e1',
    trip_id: 't1',
    description: 'Dinner',
    category: 'food',
    amount_cents: 300,
    paid_by_planner_id: 'planner-1',
    paid_by_respondent_id: null,
    itinerary_block_id: null,
    lodging_option_id: null,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    splits: [],
    ...overrides,
  };
}

function makeSplit(
  overrides: Partial<ExpenseWithSplits['splits'][number]> = {}
): ExpenseWithSplits['splits'][number] {
  return {
    id: 's1',
    expense_id: 'e1',
    amount_cents: 100,
    split_planner_id: null,
    split_respondent_id: 'r1',
    is_settled: false,
    settled_at: null,
    created_at: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

const PLANNER: Pick<Profile, 'id' | 'name'> = { id: 'planner-1', name: 'Alice' };
const RESPONDENTS: Respondent[] = [
  { id: 'r1', trip_id: 't1', name: 'Bob', email: null, phone: null, session_token: 'tok1', is_planner: false, rsvp: null, preferences: null, created_at: '2025-01-01' },
  { id: 'r2', trip_id: 't1', name: 'Carol', email: null, phone: null, session_token: 'tok2', is_planner: false, rsvp: null, preferences: null, created_at: '2025-01-01' },
];

// ─── equalSplitCents ──────────────────────────────────────────────────────────

describe('equalSplitCents', () => {
  it('splits evenly among 3 participants', () => {
    const result = equalSplitCents(300, ['a', 'b', 'c']);
    expect(result).toHaveLength(3);
    expect(result.every((r) => r.amountCents === 100)).toBe(true);
    expect(result.reduce((s, r) => s + r.amountCents, 0)).toBe(300);
  });

  it('assigns remainder to the first participant', () => {
    // 100 / 3 = 33 with remainder 1 → first gets 34
    const result = equalSplitCents(100, ['a', 'b', 'c']);
    expect(result[0].amountCents).toBe(34);
    expect(result[1].amountCents).toBe(33);
    expect(result[2].amountCents).toBe(33);
    expect(result.reduce((s, r) => s + r.amountCents, 0)).toBe(100);
  });

  it('handles a single participant', () => {
    const result = equalSplitCents(500, ['a']);
    expect(result).toHaveLength(1);
    expect(result[0].amountCents).toBe(500);
  });

  it('returns an empty array for zero participants', () => {
    expect(equalSplitCents(100, [])).toEqual([]);
  });

  it('always sums exactly to the total (no rounding drift)', () => {
    // Test a range of amounts and counts
    const totals = [199, 201, 1000, 7, 1];
    const counts = [2, 3, 4, 5];
    for (const total of totals) {
      for (const n of counts) {
        const ids = Array.from({ length: n }, (_, i) => `p${i}`);
        const result = equalSplitCents(total, ids);
        const sum = result.reduce((s, r) => s + r.amountCents, 0);
        expect(sum).toBe(total);
      }
    }
  });

  it('preserves participant IDs in order', () => {
    const ids = ['alice', 'bob', 'carol'];
    const result = equalSplitCents(99, ids);
    expect(result.map((r) => r.id)).toEqual(ids);
  });
});

// ─── validateSplits ───────────────────────────────────────────────────────────

describe('validateSplits', () => {
  it('passes when splits sum exactly to total', () => {
    const splits: SplitInput[] = [
      { respondentId: 'a', amountCents: 60 },
      { respondentId: 'b', amountCents: 40 },
    ];
    expect(() => validateSplits(100, splits)).not.toThrow();
  });

  it('throws when splits do not sum to total', () => {
    const splits: SplitInput[] = [
      { respondentId: 'a', amountCents: 50 },
      { respondentId: 'b', amountCents: 40 },
    ];
    expect(() => validateSplits(100, splits)).toThrow('Split total (90¢) does not equal expense total (100¢)');
  });

  it('throws for negative split amounts', () => {
    const splits: SplitInput[] = [
      { respondentId: 'a', amountCents: 110 },
      { respondentId: 'b', amountCents: -10 },
    ];
    expect(() => validateSplits(100, splits)).toThrow('negative');
  });

  it('allows a zero-amount split (one party covers the full bill)', () => {
    const splits: SplitInput[] = [
      { respondentId: 'a', amountCents: 100 },
      { respondentId: 'b', amountCents: 0 },
    ];
    expect(() => validateSplits(100, splits)).not.toThrow();
  });

  it('passes for a single split equal to total', () => {
    const splits: SplitInput[] = [{ plannerId: 'p1', amountCents: 250 }];
    expect(() => validateSplits(250, splits)).not.toThrow();
  });
});

// ─── computeBalances ──────────────────────────────────────────────────────────

describe('computeBalances', () => {
  it('returns zero balances when no expenses exist', () => {
    const balances = computeBalances([], RESPONDENTS, PLANNER);
    expect(balances).toHaveLength(3); // planner + 2 respondents
    expect(balances.every((b) => b.owes === 0 && b.owed === 0 && b.net === 0)).toBe(true);
  });

  it('correctly tracks who owes whom after a shared expense', () => {
    // Alice pays $3.00; Bob and Carol each owe $1.00
    const expenses: ExpenseWithSplits[] = [
      makeExpense({
        amount_cents: 300,
        paid_by_planner_id: 'planner-1',
        splits: [
          makeSplit({ id: 's1', split_respondent_id: 'r1', amount_cents: 100 }),
          makeSplit({ id: 's2', split_respondent_id: 'r2', amount_cents: 100 }),
        ],
      }),
    ];

    const balances = computeBalances(expenses, RESPONDENTS, PLANNER);
    const alice = balances.find((b) => b.id === 'planner-1')!;
    const bob = balances.find((b) => b.id === 'r1')!;
    const carol = balances.find((b) => b.id === 'r2')!;

    expect(alice.owed).toBe(200); // Bob + Carol owe her
    expect(alice.owes).toBe(0);
    expect(alice.net).toBe(200);

    expect(bob.owes).toBe(100);
    expect(bob.net).toBe(-100);

    expect(carol.owes).toBe(100);
    expect(carol.net).toBe(-100);
  });

  it('skips settled splits in the balance calculation', () => {
    const expenses: ExpenseWithSplits[] = [
      makeExpense({
        paid_by_planner_id: 'planner-1',
        splits: [
          makeSplit({ is_settled: true, settled_at: '2025-01-02T00:00:00Z' }),
        ],
      }),
    ];

    const balances = computeBalances(expenses, RESPONDENTS, PLANNER);
    const alice = balances.find((b) => b.id === 'planner-1')!;
    const bob = balances.find((b) => b.id === 'r1')!;

    expect(alice.owed).toBe(0);
    expect(bob.owes).toBe(0);
  });

  it('net is always owed minus owes', () => {
    const expenses: ExpenseWithSplits[] = [
      makeExpense({
        paid_by_planner_id: 'planner-1',
        splits: [makeSplit({ amount_cents: 50 })],
      }),
    ];
    const balances = computeBalances(expenses, RESPONDENTS, PLANNER);
    for (const b of balances) {
      expect(b.net).toBe(b.owed - b.owes);
    }
  });

  it('skips expenses with no payer', () => {
    const expenses: ExpenseWithSplits[] = [
      makeExpense({ paid_by_planner_id: null, paid_by_respondent_id: null }),
    ];
    const balances = computeBalances(expenses, RESPONDENTS, PLANNER);
    expect(balances.every((b) => b.net === 0)).toBe(true);
  });
});

// ─── exportExpensesCsv ────────────────────────────────────────────────────────

describe('exportExpensesCsv', () => {
  it('starts with a header row', () => {
    const csv = exportExpensesCsv([], RESPONDENTS, PLANNER);
    const [header] = csv.split('\n');
    expect(header).toContain('Description');
    expect(header).toContain('Category');
    expect(header).toContain('Paid By');
    expect(header).toContain('Settled');
  });

  it('generates one data row per split', () => {
    const expense = makeExpense({
      splits: [
        makeSplit({ id: 's1', split_respondent_id: 'r1', amount_cents: 100 }),
        makeSplit({ id: 's2', split_respondent_id: 'r2', amount_cents: 100 }),
      ],
    });
    const csv = exportExpensesCsv([expense], RESPONDENTS, PLANNER);
    const lines = csv.split('\n').filter(Boolean);
    expect(lines).toHaveLength(3); // 1 header + 2 splits
  });

  it('marks settled splits as "Yes"', () => {
    const expense = makeExpense({
      splits: [
        makeSplit({ is_settled: true, settled_at: '2025-01-02T00:00:00Z' }),
      ],
    });
    const csv = exportExpensesCsv([expense], RESPONDENTS, PLANNER);
    expect(csv).toContain('"Yes"');
  });

  it('escapes embedded quotes in field values', () => {
    const expense = makeExpense({
      description: 'The "cabin" fee',
      splits: [makeSplit()],
    });
    const csv = exportExpensesCsv([expense], RESPONDENTS, PLANNER);
    expect(csv).toContain('"The ""cabin"" fee"');
  });

  it('formats amounts as dollar values', () => {
    const expense = makeExpense({
      amount_cents: 4999,
      splits: [makeSplit({ amount_cents: 4999 })],
    });
    const csv = exportExpensesCsv([expense], RESPONDENTS, PLANNER);
    expect(csv).toContain('49.99');
  });
});

// ─── buildVenmoLink ───────────────────────────────────────────────────────────

describe('buildVenmoLink', () => {
  it('constructs a venmo:// deep link', () => {
    const link = buildVenmoLink(1234, 'Rally: Hotel');
    expect(link).toBe('venmo://paycharge?txn=pay&amount=12.34&note=Rally%3A%20Hotel');
  });

  it('formats cents to dollars with 2 decimal places', () => {
    const link = buildVenmoLink(500, 'Test');
    expect(link).toContain('amount=5.00');
  });

  it('URL-encodes spaces and special characters in the note', () => {
    const link = buildVenmoLink(100, 'A & B');
    expect(link).toContain('note=A%20%26%20B');
  });

  it('handles round dollar amounts', () => {
    const link = buildVenmoLink(2000, 'Ski lodge');
    expect(link).toContain('amount=20.00');
  });
});
