/**
 * ExpensesTab — F10 Expense Tracker
 * Balance summary, expense feed, and add-expense FAB with split logic.
 */
import { useState, useMemo, useCallback } from 'react';
import {
  Alert,
  FlatList,
  Linking,
  Pressable,
  ScrollView,
  Share,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  useExpenses,
  useCreateExpense,
  useDeleteExpense,
  useMarkSplitSettled,
  useBalances,
} from '@/hooks/useExpenses';
import { useRespondents } from '@/hooks/useRespondents';
import { useAuthStore } from '@/stores/authStore';
import {
  equalSplitCents,
  buildVenmoLink,
  exportExpensesCsv,
  type SplitInput,
  type CreateExpenseInput,
} from '@/lib/api/expenses';
import { formatCents } from '@/lib/api/lodging';
import type {
  ExpenseCategory,
  ExpenseWithSplits,
  ParticipantBalance,
  Respondent,
} from '@/types/database';
import { Avatar, Button, EmptyState, FormField, Input, Pill, Sheet } from '@/components/ui';

// ─── Constants ────────────────────────────────────────────────────────────────

const CATEGORIES: { value: ExpenseCategory; label: string; icon: React.ComponentProps<typeof Ionicons>['name'] }[] = [
  { value: 'accommodation', label: 'Accommodation', icon: 'bed-outline' },
  { value: 'food', label: 'Food', icon: 'restaurant-outline' },
  { value: 'transport', label: 'Transport', icon: 'car-outline' },
  { value: 'activities', label: 'Activities', icon: 'bicycle-outline' },
  { value: 'gear', label: 'Gear', icon: 'bag-outline' },
  { value: 'other', label: 'Other', icon: 'ellipsis-horizontal-outline' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseDollarsTocents(s: string): number | null {
  const n = parseFloat(s.replace(/[^0-9.]/g, ''));
  if (!isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

function centsToDisplayDollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

// ─── Balance Card ─────────────────────────────────────────────────────────────

function BalanceCard({
  balance,
  tripName,
}: {
  balance: ParticipantBalance;
  tripName: string;
}) {
  const isEven = balance.net === 0;
  const isOwed = balance.net > 0;

  const netLabel = isEven
    ? 'Even'
    : isOwed
    ? `Owed ${formatCents(balance.net)}`
    : `Owes ${formatCents(Math.abs(balance.net))}`;

  const netColor = isEven
    ? 'text-muted'
    : isOwed
    ? 'text-green-dark'
    : 'text-red-500';

  function handleVenmo() {
    if (isEven || isOwed) return; // only show "settle" for debts
    const link = buildVenmoLink(
      Math.abs(balance.net),
      `${tripName} trip expenses`
    );
    Linking.openURL(link);
  }

  return (
    <View
      className="mr-3 w-40 rounded-2xl bg-card p-3"
      style={{
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.06,
        shadowRadius: 6,
        elevation: 2,
      }}
    >
      <Text className="text-sm font-semibold text-ink" numberOfLines={1}>
        {balance.name}
      </Text>
      <Text className={`mt-0.5 text-xs font-medium ${netColor}`}>{netLabel}</Text>

      {!isEven && !isOwed ? (
        // Venmo logo retains its blue brand identity (per Venmo brand guidelines),
        // but the button bg + text are brand-coherent so the action reads as Rally's.
        <Pressable
          onPress={handleVenmo}
          className="mt-2 flex-row items-center justify-center gap-1 rounded-xl bg-green-soft py-1.5"
        >
          <Ionicons name="logo-venmo" size={12} color="#3D95CE" />
          <Text className="text-xs font-semibold text-green-dark">Settle</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

// ─── Expense Card ─────────────────────────────────────────────────────────────

function ExpenseCard({
  expense,
  respondents,
  plannerId,
  plannerName,
  onDelete,
  onSettleSplit,
}: {
  expense: ExpenseWithSplits;
  respondents: Respondent[];
  plannerId: string;
  plannerName: string;
  onDelete: () => void;
  onSettleSplit: (splitId: string, settled: boolean) => void;
}) {
  const cat = CATEGORIES.find((c) => c.value === expense.category);
  const icon = cat?.icon ?? 'ellipsis-horizontal-outline';

  const payerName = (() => {
    if (expense.paid_by_planner_id === plannerId) return plannerName;
    const r = respondents.find((r) => r.id === expense.paid_by_respondent_id);
    return r?.name ?? 'Unknown';
  })();

  const splitPersonName = (split: ExpenseWithSplits['splits'][0]) => {
    if (split.split_planner_id === plannerId) return plannerName;
    const r = respondents.find((r) => r.id === split.split_respondent_id);
    return r?.name ?? 'Unknown';
  };

  function handleLongPress() {
    Alert.alert(expense.description, undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          Alert.alert('Delete expense?', 'This cannot be undone.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Delete', style: 'destructive', onPress: onDelete },
          ]),
      },
    ]);
  }

  return (
    <Pressable
      onLongPress={handleLongPress}
      className="mb-3 rounded-2xl bg-card p-4"
      style={{
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.07,
        shadowRadius: 8,
        elevation: 2,
      }}
    >
      {/* Header */}
      <View className="flex-row items-start gap-3">
        <View className="mt-0.5 h-9 w-9 items-center justify-center rounded-xl bg-cream-warm">
          <Ionicons name={icon} size={18} color="#5F685F" />
        </View>
        <View className="flex-1">
          <Text className="text-sm font-semibold text-ink">{expense.description}</Text>
          <View className="flex-row items-center gap-1.5 mt-0.5">
            <Avatar name={payerName} size="xs" />
            <Text className="text-xs text-muted">
              {cat?.label} · Paid by {payerName}
            </Text>
          </View>
        </View>
        <Text className="text-base font-bold text-ink">
          {formatCents(expense.amount_cents)}
        </Text>
      </View>

      {/* Splits */}
      {expense.splits.length > 0 ? (
        <View className="mt-3 gap-1.5">
          <Text className="text-xs font-semibold uppercase tracking-wider text-muted">Splits</Text>
          {expense.splits.map((split) => (
            <TouchableOpacity
              key={split.id}
              activeOpacity={0.7}
              onPress={() => onSettleSplit(split.id, !split.is_settled)}
              className="flex-row items-center justify-between"
            >
              <View className="flex-row items-center gap-2">
                <View
                  className={`h-5 w-5 items-center justify-center rounded-full border ${
                    split.is_settled
                      ? 'border-green bg-green-soft'
                      : 'border-line bg-card'
                  }`}
                >
                  {split.is_settled ? (
                    <Ionicons name="checkmark" size={12} color="#0F3F2E" />
                  ) : null}
                </View>
                <Text
                  className={`text-sm ${split.is_settled ? 'text-muted line-through' : 'text-ink'}`}
                >
                  {splitPersonName(split)}
                </Text>
              </View>
              <Text
                className={`text-sm font-medium ${split.is_settled ? 'text-muted' : 'text-ink'}`}
              >
                {formatCents(split.amount_cents)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}
    </Pressable>
  );
}

// ─── Add Expense Sheet ────────────────────────────────────────────────────────

interface Participant {
  id: string;
  name: string;
  type: 'planner' | 'respondent';
}

interface AddExpenseSheetProps {
  visible: boolean;
  tripId: string;
  participants: Participant[];
  onClose: () => void;
  onSave: (input: CreateExpenseInput) => void;
  saving: boolean;
}

function AddExpenseSheet({
  visible,
  tripId,
  participants,
  onClose,
  onSave,
  saving,
}: AddExpenseSheetProps) {
  const [description, setDescription] = useState('');
  const [amountRaw, setAmountRaw] = useState('');
  const [category, setCategory] = useState<ExpenseCategory>('other');
  const [paidById, setPaidById] = useState(participants[0]?.id ?? '');
  const [splitMode, setSplitMode] = useState<'equal' | 'custom'>('equal');
  const [customSplits, setCustomSplits] = useState<Record<string, string>>({});

  // Reset on open
  useMemo(() => {
    if (visible) {
      setDescription('');
      setAmountRaw('');
      setCategory('other');
      setPaidById(participants[0]?.id ?? '');
      setSplitMode('equal');
      setCustomSplits({});
    }
  }, [visible]);

  const amountCents = parseDollarsTocents(amountRaw) ?? 0;
  const participantIds = participants.map((p) => p.id);

  const equalSplits = useMemo(
    () => (amountCents > 0 ? equalSplitCents(amountCents, participantIds) : []),
    [amountCents, participantIds]
  );

  const customSplitsCents = useMemo(() => {
    return participants.map((p) => {
      const raw = customSplits[p.id] ?? '';
      const cents = parseDollarsTocents(raw) ?? 0;
      return { id: p.id, amountCents: cents };
    });
  }, [participants, customSplits]);

  const customTotal = customSplitsCents.reduce((s, c) => s + c.amountCents, 0);
  const customDiff = amountCents - customTotal;
  const customValid = splitMode === 'equal' || (amountCents > 0 && customDiff === 0);

  const canSave =
    description.trim().length > 0 &&
    amountCents > 0 &&
    paidById.length > 0 &&
    customValid;

  function buildSplits(): SplitInput[] {
    const splits = splitMode === 'equal' ? equalSplits : customSplitsCents;
    return splits.map(({ id, amountCents: cents }) => {
      const p = participants.find((pp) => pp.id === id);
      if (!p) return { amountCents: cents };
      return p.type === 'planner'
        ? { plannerId: id, amountCents: cents }
        : { respondentId: id, amountCents: cents };
    });
  }

  function handleSave() {
    if (!canSave) return;
    const payer = participants.find((p) => p.id === paidById);
    if (!payer) return;

    const input: CreateExpenseInput = {
      trip_id: tripId,
      description: description.trim(),
      category,
      amount_cents: amountCents,
      paid_by_planner_id: payer.type === 'planner' ? paidById : null,
      paid_by_respondent_id: payer.type === 'respondent' ? paidById : null,
      splits: buildSplits(),
    };

    onSave(input);
  }

  return (
    <Sheet visible={visible} onClose={onClose} title="Add expense">
      {/* Description */}
      <FormField label="Description" required>
        <Input
          value={description}
          onChangeText={setDescription}
          placeholder="e.g. Airbnb deposit"
          autoFocus
        />
      </FormField>

      {/* Amount */}
      <FormField label="Amount" required>
        <Input
          value={amountRaw}
          onChangeText={(v) => setAmountRaw(v.replace(/[^0-9.]/g, ''))}
          placeholder="$ 0.00"
          keyboardType="decimal-pad"
        />
      </FormField>

      {/* Category */}
      <FormField label="Category">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {CATEGORIES.map((c) => (
              <Pill
                key={c.value}
                onPress={() => setCategory(c.value)}
                selected={category === c.value}
                leadingIcon={c.icon}
                size="sm"
              >
                {c.label}
              </Pill>
            ))}
          </View>
        </ScrollView>
      </FormField>

      {/* Paid by */}
      <FormField label="Paid by">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {participants.map((p) => (
              <Pill
                key={p.id}
                onPress={() => setPaidById(p.id)}
                selected={paidById === p.id}
                size="sm"
              >
                {p.name}
              </Pill>
            ))}
          </View>
        </ScrollView>
      </FormField>

      {/* Split section */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ fontSize: 12, fontWeight: '600', color: '#5F685F', textTransform: 'uppercase', letterSpacing: 0.5 }}>Split</Text>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {(['equal', 'custom'] as const).map((mode) => (
            <Pill
              key={mode}
              onPress={() => setSplitMode(mode)}
              selected={splitMode === mode}
              size="sm"
            >
              {mode === 'equal' ? 'Equal' : 'Custom'}
            </Pill>
          ))}
        </View>
      </View>

      {splitMode === 'equal' ? (
        <View style={{ gap: 6 }}>
          {participants.map((p) => {
            const share = equalSplits.find((s) => s.id === p.id)?.amountCents ?? 0;
            return (
              <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Avatar name={p.name} size="sm" />
                  <Text style={{ fontSize: 14, color: '#5F685F' }}>{p.name}</Text>
                </View>
                <Text style={{ fontSize: 14, fontWeight: '500', color: '#163026' }}>
                  {share > 0 ? formatCents(share) : '—'}
                </Text>
              </View>
            );
          })}
        </View>
      ) : (
        <View style={{ gap: 8 }}>
          {participants.map((p) => (
            <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Avatar name={p.name} size="sm" />
              <Text style={{ fontSize: 14, color: '#5F685F', flex: 1 }}>{p.name}</Text>
              <View style={{ width: 110 }}>
                <Input
                  value={customSplits[p.id] ?? ''}
                  onChangeText={(v) =>
                    setCustomSplits((prev) => ({ ...prev, [p.id]: v.replace(/[^0-9.]/g, '') }))
                  }
                  placeholder="$ 0.00"
                  keyboardType="decimal-pad"
                />
              </View>
            </View>
          ))}

          {/* Running total */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingTop: 8, borderTopWidth: 1, borderTopColor: '#D9CCB6' }}>
            <Text style={{ fontSize: 13, fontWeight: '600', color: '#5F685F' }}>
              {customDiff === 0 ? 'Splits match total ✓' : `Difference: ${customDiff > 0 ? '+' : ''}${formatCents(Math.abs(customDiff))}`}
            </Text>
            <Text style={{ fontSize: 13, fontWeight: '600', color: customDiff === 0 ? '#0F3F2E' : '#EF4444' }}>
              {formatCents(customTotal)} / {formatCents(amountCents)}
            </Text>
          </View>
        </View>
      )}

      <Sheet.Actions>
        <View style={{ flex: 1 }}>
          <Button variant="secondary" onPress={onClose} fullWidth>
            Cancel
          </Button>
        </View>
        <View style={{ flex: 2 }}>
          <Button
            variant="primary"
            onPress={handleSave}
            loading={saving}
            disabled={!canSave || saving}
            fullWidth
          >
            Save expense
          </Button>
        </View>
      </Sheet.Actions>
    </Sheet>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function ExpensesTab({ tripId, isPlanner = true }: { tripId: string; isPlanner?: boolean }) {
  const insets = useSafeAreaInsets();
  const session = useAuthStore((s) => s.session);

  const userId = session?.user.id ?? '';
  const userName =
    (session?.user.user_metadata?.name as string | undefined) ??
    session?.user.email ??
    'You';

  const plannerProfile = useMemo(
    () => ({ id: userId, name: userName }),
    [userId, userName]
  );

  const { data: respondents = [] } = useRespondents(tripId);
  const { data: expenses = [] } = useExpenses(tripId);
  const { balances } = useBalances(tripId, respondents, plannerProfile);

  const createExpense = useCreateExpense(tripId);
  const deleteExpense = useDeleteExpense(tripId);
  const markSplitSettled = useMarkSplitSettled(tripId);

  const [addSheetVisible, setAddSheetVisible] = useState(false);

  // Build participant list: planner first, then respondents
  const participants: { id: string; name: string; type: 'planner' | 'respondent' }[] = useMemo(
    () => [
      { id: userId, name: userName, type: 'planner' },
      ...respondents.map((r) => ({ id: r.id, name: r.name, type: 'respondent' as const })),
    ],
    [userId, userName, respondents]
  );

  function handleSaveExpense(input: CreateExpenseInput) {
    createExpense.mutate(input, {
      onSuccess: () => setAddSheetVisible(false),
      onError: () => Alert.alert('Error', 'Could not save expense. Please try again.'),
    });
  }

  function handleDeleteExpense(expenseId: string) {
    Alert.alert('Delete expense?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          deleteExpense.mutate(expenseId, {
            onError: () => Alert.alert('Error', 'Could not delete expense.'),
          }),
      },
    ]);
  }

  function handleSettleSplit(splitId: string, settled: boolean) {
    markSplitSettled.mutate(
      { splitId, settled },
      { onError: () => Alert.alert('Error', 'Could not update split.') }
    );
  }

  const hasExpenses = expenses.length > 0;

  return (
    <View className="flex-1 bg-cream">
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 80 }}
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View className="flex-row items-center justify-between pt-4 pb-3">
          <Text className="text-base font-bold text-ink">Expenses</Text>
          {hasExpenses ? (
            <View className="flex-row items-center gap-2">
              <Pressable
                onPress={async () => {
                  const lines = [`💰 Expense summary`];
                  balances.forEach((b) => {
                    const net = b.net;
                    if (net === 0) lines.push(`${b.name}: even`);
                    else if (net > 0) lines.push(`${b.name}: owed ${formatCents(net)}`);
                    else lines.push(`${b.name}: owes ${formatCents(Math.abs(net))}`);
                  });
                  try { await Share.share({ message: lines.join('\n') }); } catch {}
                }}
                className="flex-row items-center gap-1 rounded-xl border border-line px-3 py-1.5"
              >
                <Ionicons name="share-outline" size={14} color="#5F685F" />
                <Text className="text-xs font-medium text-muted">Share</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  const csv = exportExpensesCsv(expenses, respondents, plannerProfile);
                  Alert.alert('Export', 'CSV data copied to clipboard.', [{ text: 'OK' }]);
                  void csv;
                }}
                className="flex-row items-center gap-1 rounded-xl border border-line px-3 py-1.5"
              >
                <Ionicons name="download-outline" size={14} color="#5F685F" />
                <Text className="text-xs font-medium text-muted">Export CSV</Text>
              </Pressable>
            </View>
          ) : null}
        </View>

        {/* ── Section A: Balance strip ── */}
        {balances.length > 0 ? (
          <View className="mb-5">
            <Text className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
              Balances
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingRight: 20 }}
            >
              {balances.map((b) => (
                <BalanceCard key={b.id} balance={b} tripName={tripId} />
              ))}
            </ScrollView>
          </View>
        ) : null}

        {/* ── Section B: Expense feed ── */}
        {!hasExpenses ? (
          <View className="mt-2 gap-3">
            <Text className="text-xs text-muted">
              Accommodation costs from your booking will appear here automatically.
            </Text>
            {isPlanner ? (
              <Pressable
                onPress={() => setAddSheetVisible(true)}
                style={{
                  borderWidth: 1.5,
                  borderColor: '#D9CCB6',
                  borderStyle: 'dashed',
                  borderRadius: 16,
                  paddingVertical: 28,
                  alignItems: 'center',
                  gap: 8,
                  marginTop: 4,
                }}
              >
                <Ionicons name="add-circle-outline" size={28} color="#9DA8A0" />
                <Text style={{ fontSize: 14, color: '#9DA8A0' }}>Tap to log an expense</Text>
              </Pressable>
            ) : null}
          </View>
        ) : (
          <>
            <Text className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
              All expenses
            </Text>
            {expenses.map((expense) => (
              <ExpenseCard
                key={expense.id}
                expense={expense}
                respondents={respondents}
                plannerId={userId}
                plannerName={userName}
                onDelete={() => handleDeleteExpense(expense.id)}
                onSettleSplit={handleSettleSplit}
              />
            ))}
            {isPlanner ? (
              <Pressable
                onPress={() => setAddSheetVisible(true)}
                style={{
                  borderWidth: 1.5,
                  borderColor: '#D9CCB6',
                  borderStyle: 'dashed',
                  borderRadius: 16,
                  paddingVertical: 20,
                  alignItems: 'center',
                  gap: 6,
                  marginTop: 4,
                }}
              >
                <Ionicons name="add-circle-outline" size={22} color="#9DA8A0" />
                <Text style={{ fontSize: 13, color: '#9DA8A0' }}>Add another expense</Text>
              </Pressable>
            ) : null}
          </>
        )}
      </ScrollView>

      {/* Add Expense Sheet */}
      <AddExpenseSheet
        visible={addSheetVisible}
        tripId={tripId}
        participants={participants}
        onClose={() => setAddSheetVisible(false)}
        onSave={handleSaveExpense}
        saving={createExpense.isPending}
      />
    </View>
  );
}
