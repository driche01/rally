import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getExpensesForTrip,
  createExpense,
  updateExpense,
  deleteExpense,
  markSplitSettled,
  computeBalances,
  type CreateExpenseInput,
} from '@/lib/api/expenses';
import type { Profile, Respondent } from '@/types/database';

export const expenseKeys = {
  all: (tripId: string) => ['expenses', tripId] as const,
};

export function useExpenses(tripId: string) {
  return useQuery({
    queryKey: expenseKeys.all(tripId),
    queryFn: () => getExpensesForTrip(tripId),
    enabled: !!tripId,
  });
}

export function useBalances(
  tripId: string,
  respondents: Respondent[],
  planner: Pick<Profile, 'id' | 'name'> | null
) {
  const { data: expenses = [] } = useExpenses(tripId);
  if (!planner) return { balances: [] };
  const balances = computeBalances(expenses, respondents, planner);
  return { balances };
}

export function useCreateExpense(tripId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateExpenseInput) => createExpense(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: expenseKeys.all(tripId) }),
  });
}

export function useUpdateExpense(tripId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      expenseId,
      updates,
    }: {
      expenseId: string;
      updates: Parameters<typeof updateExpense>[1];
    }) => updateExpense(expenseId, updates),
    onSuccess: () => qc.invalidateQueries({ queryKey: expenseKeys.all(tripId) }),
  });
}

export function useDeleteExpense(tripId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (expenseId: string) => deleteExpense(expenseId),
    onSuccess: () => qc.invalidateQueries({ queryKey: expenseKeys.all(tripId) }),
  });
}

export function useMarkSplitSettled(tripId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      splitId,
      settled,
    }: {
      splitId: string;
      settled: boolean;
    }) => markSplitSettled(splitId, settled),
    onSuccess: () => qc.invalidateQueries({ queryKey: expenseKeys.all(tripId) }),
  });
}
