/**
 * Expense Tracker API
 *
 * ALL monetary values are stored and computed in integer cents (never floats).
 * Rounding always favours the payer — the payer's split gets any remainder.
 */
import { supabase } from '../supabase';
import type {
  Expense,
  ExpenseSplit,
  ExpenseWithSplits,
  ParticipantBalance,
  ExpenseCategory,
  Respondent,
  Profile,
} from '../../types/database';

// ─── Expense CRUD ─────────────────────────────────────────────────────────────

export interface SplitInput {
  /** respondent_id — mutually exclusive with plannerSplit */
  respondentId?: string;
  /** planner_id — mutually exclusive with respondentId */
  plannerId?: string;
  amountCents: number;
}

export interface CreateExpenseInput {
  trip_id: string;
  description: string;
  category: ExpenseCategory;
  /** Total in cents */
  amount_cents: number;
  paid_by_planner_id?: string | null;
  paid_by_respondent_id?: string | null;
  itinerary_block_id?: string | null;
  lodging_option_id?: string | null;
  splits: SplitInput[];
}

export async function getExpensesForTrip(
  tripId: string
): Promise<ExpenseWithSplits[]> {
  const { data: expenses, error: expErr } = await supabase
    .from('expenses')
    .select('*')
    .eq('trip_id', tripId)
    .order('created_at', { ascending: true });
  if (expErr) throw expErr;

  if (!expenses?.length) return [];

  const expenseIds = expenses.map((e) => e.id);
  const { data: splits, error: splitErr } = await supabase
    .from('expense_splits')
    .select('*')
    .in('expense_id', expenseIds);
  if (splitErr) throw splitErr;

  return expenses.map((exp) => ({
    ...exp,
    splits: (splits ?? []).filter((s) => s.expense_id === exp.id),
  }));
}

export async function createExpense(
  input: CreateExpenseInput
): Promise<ExpenseWithSplits> {
  validateSplits(input.amount_cents, input.splits);

  const { splits, ...expenseData } = input;

  const { data: expense, error: expErr } = await supabase
    .from('expenses')
    .insert(expenseData)
    .select()
    .single();
  if (expErr) throw expErr;

  const splitRows = splits.map((s) => ({
    expense_id: expense.id,
    amount_cents: s.amountCents,
    split_respondent_id: s.respondentId ?? null,
    split_planner_id: s.plannerId ?? null,
  }));

  const { data: splitData, error: splitErr } = await supabase
    .from('expense_splits')
    .insert(splitRows)
    .select();
  if (splitErr) throw splitErr;

  return { ...expense, splits: splitData ?? [] };
}

export async function updateExpense(
  expenseId: string,
  updates: Partial<Omit<CreateExpenseInput, 'trip_id' | 'splits'>>
): Promise<Expense> {
  const { data, error } = await supabase
    .from('expenses')
    .update(updates)
    .eq('id', expenseId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteExpense(expenseId: string): Promise<void> {
  const { error } = await supabase
    .from('expenses')
    .delete()
    .eq('id', expenseId);
  if (error) throw error;
}

// ─── Settlements ──────────────────────────────────────────────────────────────

export async function markSplitSettled(
  splitId: string,
  settled: boolean
): Promise<void> {
  const { error } = await supabase
    .from('expense_splits')
    .update({
      is_settled: settled,
      settled_at: settled ? new Date().toISOString() : null,
    })
    .eq('id', splitId);
  if (error) throw error;
}

// ─── Balance calculation ──────────────────────────────────────────────────────

/**
 * Computes net balances for all participants on a trip.
 * All arithmetic in integer cents — no floats ever.
 */
export function computeBalances(
  expenses: ExpenseWithSplits[],
  respondents: Respondent[],
  planner: Pick<Profile, 'id' | 'name'>
): ParticipantBalance[] {
  // Map: participantId → { owes (to others), owed (by others) }
  const balanceMap = new Map<
    string,
    { name: string; type: 'planner' | 'respondent'; owes: number; owed: number }
  >();

  const get = (id: string) => balanceMap.get(id)!;
  const set = (
    id: string,
    name: string,
    type: 'planner' | 'respondent',
    owes: number,
    owed: number
  ) => {
    const existing = balanceMap.get(id);
    balanceMap.set(id, {
      name,
      type,
      owes: (existing?.owes ?? 0) + owes,
      owed: (existing?.owed ?? 0) + owed,
    });
  };

  // Pre-populate all participants at zero
  set(planner.id, planner.name, 'planner', 0, 0);
  for (const r of respondents) {
    set(r.id, r.name, 'respondent', 0, 0);
  }

  for (const expense of expenses) {
    const payerId = expense.paid_by_planner_id ?? expense.paid_by_respondent_id;
    if (!payerId) continue;

    for (const split of expense.splits) {
      if (split.is_settled) continue;

      const splitPersonId = split.split_planner_id ?? split.split_respondent_id;
      if (!splitPersonId || splitPersonId === payerId) continue;

      // splitPerson owes payer
      const splitPersonName = splitPersonId === planner.id
        ? planner.name
        : respondents.find((r) => r.id === splitPersonId)?.name ?? 'Unknown';
      const payerName = payerId === planner.id
        ? planner.name
        : respondents.find((r) => r.id === payerId)?.name ?? 'Unknown';

      const splitType = split.split_planner_id ? 'planner' : 'respondent';
      const payerType = expense.paid_by_planner_id ? 'planner' : 'respondent';

      set(splitPersonId, splitPersonName, splitType, split.amount_cents, 0);
      set(payerId, payerName, payerType, 0, split.amount_cents);
    }
  }

  return Array.from(balanceMap.entries()).map(([id, b]) => ({
    id,
    name: b.name,
    type: b.type,
    owes: b.owes,
    owed: b.owed,
    net: b.owed - b.owes,
  }));
}

// ─── Equal split helper ───────────────────────────────────────────────────────

/**
 * Divides amountCents equally among N participants.
 * The first participant (the payer's index, or index 0) absorbs any remainder
 * so the splits always sum to the total — no rounding drift.
 */
export function equalSplitCents(
  amountCents: number,
  participantIds: string[]
): { id: string; amountCents: number }[] {
  const n = participantIds.length;
  if (n === 0) return [];

  const base = Math.floor(amountCents / n);
  const remainder = amountCents - base * n;

  return participantIds.map((id, i) => ({
    id,
    amountCents: i === 0 ? base + remainder : base,
  }));
}

// ─── Validation ───────────────────────────────────────────────────────────────

export function validateSplits(
  totalCents: number,
  splits: SplitInput[]
): void {
  const sum = splits.reduce((acc, s) => acc + s.amountCents, 0);
  if (sum !== totalCents) {
    throw new Error(
      `Split total (${sum}¢) does not equal expense total (${totalCents}¢)`
    );
  }
  if (splits.some((s) => s.amountCents < 0)) {
    throw new Error('Split amounts cannot be negative');
  }
}

// ─── CSV export ───────────────────────────────────────────────────────────────

export function exportExpensesCsv(
  expenses: ExpenseWithSplits[],
  respondents: Respondent[],
  planner: Pick<Profile, 'id' | 'name'>
): string {
  const participantName = (id: string | null) => {
    if (!id) return '';
    if (id === planner.id) return planner.name;
    return respondents.find((r) => r.id === id)?.name ?? id;
  };

  const rows: string[][] = [
    [
      'Date',
      'Description',
      'Category',
      'Total',
      'Paid By',
      'Split For',
      'Split Amount',
      'Settled',
    ],
  ];

  for (const exp of expenses) {
    const payer = participantName(
      exp.paid_by_planner_id ?? exp.paid_by_respondent_id
    );
    const date = new Date(exp.created_at).toLocaleDateString('en-US');
    const total = (exp.amount_cents / 100).toFixed(2);

    for (const split of exp.splits) {
      const splitFor = participantName(
        split.split_planner_id ?? split.split_respondent_id
      );
      const splitAmt = (split.amount_cents / 100).toFixed(2);
      rows.push([
        date,
        exp.description,
        exp.category,
        total,
        payer,
        splitFor,
        splitAmt,
        split.is_settled ? 'Yes' : 'No',
      ]);
    }
  }

  return rows
    .map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(','))
    .join('\n');
}

/** Deep-link to Venmo for settling a balance */
export function buildVenmoLink(
  amount: number, // cents
  note: string
): string {
  const dollars = (amount / 100).toFixed(2);
  return `venmo://paycharge?txn=pay&amount=${dollars}&note=${encodeURIComponent(note)}`;
}
