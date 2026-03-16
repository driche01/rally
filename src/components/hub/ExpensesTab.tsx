/**
 * ExpensesTab — F10 Expense Tracker
 * Balance summary, expense feed, and add-expense FAB with split logic.
 */
import { useState, useMemo, useCallback } from 'react';
import {
  Alert,
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
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
    ? 'text-neutral-400'
    : isOwed
    ? 'text-green-600'
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
      className="mr-3 w-40 rounded-2xl bg-white p-3"
      style={{
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.06,
        shadowRadius: 6,
        elevation: 2,
      }}
    >
      <Text className="text-sm font-semibold text-neutral-800" numberOfLines={1}>
        {balance.name}
      </Text>
      <Text className={`mt-0.5 text-xs font-medium ${netColor}`}>{netLabel}</Text>

      {!isEven && !isOwed ? (
        <Pressable
          onPress={handleVenmo}
          className="mt-2 flex-row items-center justify-center gap-1 rounded-xl bg-blue-50 py-1.5"
        >
          <Ionicons name="logo-venmo" size={12} color="#2563EB" />
          <Text className="text-xs font-semibold text-blue-600">Settle</Text>
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
      className="mb-3 rounded-2xl bg-white p-4"
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
        <View className="mt-0.5 h-9 w-9 items-center justify-center rounded-xl bg-neutral-100">
          <Ionicons name={icon} size={18} color="#737373" />
        </View>
        <View className="flex-1">
          <Text className="text-sm font-semibold text-neutral-800">{expense.description}</Text>
          <Text className="text-xs text-neutral-400">
            {cat?.label} · Paid by {payerName}
          </Text>
        </View>
        <Text className="text-base font-bold text-neutral-800">
          {formatCents(expense.amount_cents)}
        </Text>
      </View>

      {/* Splits */}
      {expense.splits.length > 0 ? (
        <View className="mt-3 gap-1.5">
          <Text className="text-xs font-semibold uppercase tracking-wider text-neutral-400">Splits</Text>
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
                      ? 'border-green-400 bg-green-50'
                      : 'border-neutral-200 bg-white'
                  }`}
                >
                  {split.is_settled ? (
                    <Ionicons name="checkmark" size={12} color="#16A34A" />
                  ) : null}
                </View>
                <Text
                  className={`text-sm ${split.is_settled ? 'text-neutral-400 line-through' : 'text-neutral-700'}`}
                >
                  {splitPersonName(split)}
                </Text>
              </View>
              <Text
                className={`text-sm font-medium ${split.is_settled ? 'text-neutral-400' : 'text-neutral-700'}`}
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
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}
        onPress={onClose}
      >
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <ScrollView
            style={{ backgroundColor: 'white', borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '90%' }}
            contentContainerStyle={{ padding: 24, gap: 16 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Pressable onPress={() => {}}>
              <View style={{ alignItems: 'center', marginBottom: 4 }}>
                <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: '#E5E5E5' }} />
              </View>

              <Text style={{ fontSize: 17, fontWeight: '700', color: '#1C1C1C', marginBottom: 20 }}>
                Add expense
              </Text>

              {/* Description */}
              <Text style={{ fontSize: 12, fontWeight: '600', color: '#737373', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>Description *</Text>
              <TextInput
                value={description}
                onChangeText={setDescription}
                placeholder="e.g. Airbnb deposit"
                placeholderTextColor="#A3A3A3"
                style={{ borderWidth: 1.5, borderColor: '#E5E5E5', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: '#1C1C1C', marginBottom: 16 }}
                autoFocus
              />

              {/* Amount */}
              <Text style={{ fontSize: 12, fontWeight: '600', color: '#737373', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>Amount *</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderColor: '#E5E5E5', borderRadius: 12, paddingHorizontal: 14, marginBottom: 16 }}>
                <Text style={{ fontSize: 18, fontWeight: '600', color: '#737373', marginRight: 4 }}>$</Text>
                <TextInput
                  value={amountRaw}
                  onChangeText={(v) => setAmountRaw(v.replace(/[^0-9.]/g, ''))}
                  placeholder="0.00"
                  placeholderTextColor="#A3A3A3"
                  keyboardType="decimal-pad"
                  style={{ flex: 1, paddingVertical: 12, fontSize: 18, fontWeight: '600', color: '#1C1C1C' }}
                />
              </View>

              {/* Category */}
              <Text style={{ fontSize: 12, fontWeight: '600', color: '#737373', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>Category</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, marginBottom: 16 }}>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {CATEGORIES.map((c) => {
                    const active = category === c.value;
                    return (
                      <Pressable
                        key={c.value}
                        onPress={() => setCategory(c.value)}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 6,
                          paddingHorizontal: 12,
                          paddingVertical: 7,
                          borderRadius: 20,
                          borderWidth: 1.5,
                          borderColor: active ? '#FF6B5B' : '#E5E5E5',
                          backgroundColor: active ? '#FFF1F0' : 'white',
                        }}
                      >
                        <Ionicons name={c.icon} size={13} color={active ? '#FF6B5B' : '#737373'} />
                        <Text style={{ fontSize: 12, fontWeight: '600', color: active ? '#FF6B5B' : '#737373' }}>
                          {c.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </ScrollView>

              {/* Paid by */}
              <Text style={{ fontSize: 12, fontWeight: '600', color: '#737373', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>Paid by</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, marginBottom: 16 }}>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {participants.map((p) => {
                    const active = paidById === p.id;
                    return (
                      <Pressable
                        key={p.id}
                        onPress={() => setPaidById(p.id)}
                        style={{
                          paddingHorizontal: 12,
                          paddingVertical: 7,
                          borderRadius: 20,
                          borderWidth: 1.5,
                          borderColor: active ? '#FF6B5B' : '#E5E5E5',
                          backgroundColor: active ? '#FFF1F0' : 'white',
                        }}
                      >
                        <Text style={{ fontSize: 12, fontWeight: '600', color: active ? '#FF6B5B' : '#737373' }}>
                          {p.name}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </ScrollView>

              {/* Split section */}
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <Text style={{ fontSize: 12, fontWeight: '600', color: '#737373', textTransform: 'uppercase', letterSpacing: 0.5 }}>Split</Text>
                <View style={{ flexDirection: 'row', borderRadius: 10, borderWidth: 1, borderColor: '#E5E5E5', overflow: 'hidden' }}>
                  {(['equal', 'custom'] as const).map((mode) => (
                    <Pressable
                      key={mode}
                      onPress={() => setSplitMode(mode)}
                      style={{
                        paddingHorizontal: 12,
                        paddingVertical: 5,
                        backgroundColor: splitMode === mode ? '#FF6B5B' : 'white',
                      }}
                    >
                      <Text style={{ fontSize: 12, fontWeight: '600', color: splitMode === mode ? 'white' : '#737373' }}>
                        {mode === 'equal' ? 'Equal' : 'Custom'}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              {splitMode === 'equal' ? (
                <View style={{ gap: 6, marginBottom: 20 }}>
                  {participants.map((p) => {
                    const share = equalSplits.find((s) => s.id === p.id)?.amountCents ?? 0;
                    return (
                      <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                        <Text style={{ fontSize: 14, color: '#525252' }}>{p.name}</Text>
                        <Text style={{ fontSize: 14, fontWeight: '500', color: '#1C1C1C' }}>
                          {share > 0 ? formatCents(share) : '—'}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              ) : (
                <View style={{ gap: 8, marginBottom: 20 }}>
                  {participants.map((p) => (
                    <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                      <Text style={{ fontSize: 14, color: '#525252', flex: 1 }}>{p.name}</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderColor: '#E5E5E5', borderRadius: 10, paddingHorizontal: 10, width: 100 }}>
                        <Text style={{ fontSize: 14, color: '#737373', marginRight: 3 }}>$</Text>
                        <TextInput
                          value={customSplits[p.id] ?? ''}
                          onChangeText={(v) =>
                            setCustomSplits((prev) => ({ ...prev, [p.id]: v.replace(/[^0-9.]/g, '') }))
                          }
                          placeholder="0.00"
                          placeholderTextColor="#A3A3A3"
                          keyboardType="decimal-pad"
                          style={{ flex: 1, paddingVertical: 8, fontSize: 14, color: '#1C1C1C' }}
                        />
                      </View>
                    </View>
                  ))}

                  {/* Running total */}
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingTop: 8, borderTopWidth: 1, borderTopColor: '#F0F0F0' }}>
                    <Text style={{ fontSize: 13, fontWeight: '600', color: '#737373' }}>
                      {customDiff === 0 ? 'Splits match total ✓' : `Difference: ${customDiff > 0 ? '+' : ''}${formatCents(Math.abs(customDiff))}`}
                    </Text>
                    <Text style={{ fontSize: 13, fontWeight: '600', color: customDiff === 0 ? '#16A34A' : '#EF4444' }}>
                      {formatCents(customTotal)} / {formatCents(amountCents)}
                    </Text>
                  </View>
                </View>
              )}

              {/* Save */}
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Pressable
                  onPress={onClose}
                  style={{ flex: 1, paddingVertical: 14, borderRadius: 14, borderWidth: 1.5, borderColor: '#E5E5E5', alignItems: 'center' }}
                >
                  <Text style={{ fontSize: 15, fontWeight: '600', color: '#525252' }}>Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={handleSave}
                  disabled={!canSave || saving}
                  style={{ flex: 2, paddingVertical: 14, borderRadius: 14, backgroundColor: canSave ? '#FF6B5B' : '#FCA99F', alignItems: 'center', justifyContent: 'center' }}
                >
                  {saving ? (
                    <ActivityIndicator size="small" color="white" />
                  ) : (
                    <Text style={{ fontSize: 15, fontWeight: '600', color: 'white' }}>Save expense</Text>
                  )}
                </Pressable>
              </View>
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function ExpensesTab({ tripId }: { tripId: string }) {
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
    <View className="flex-1 bg-neutral-50">
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 80 }}
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View className="flex-row items-center justify-between pt-4 pb-3">
          <Text className="text-base font-bold text-neutral-800">Expenses</Text>
          {hasExpenses ? (
            <Pressable
              onPress={() => {
                const csv = exportExpensesCsv(expenses, respondents, plannerProfile);
                Alert.alert('Export', 'CSV data copied to clipboard.', [{ text: 'OK' }]);
                // In a real implementation: Clipboard.setString(csv)
                void csv;
              }}
              className="flex-row items-center gap-1 rounded-xl border border-neutral-200 px-3 py-1.5"
            >
              <Ionicons name="download-outline" size={14} color="#737373" />
              <Text className="text-xs font-medium text-neutral-600">Export CSV</Text>
            </Pressable>
          ) : null}
        </View>

        {/* ── Section A: Balance strip ── */}
        {balances.length > 0 ? (
          <View className="mb-5">
            <Text className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-400">
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
          <View className="mt-6 items-center gap-3 py-8">
            <View className="h-14 w-14 items-center justify-center rounded-2xl bg-neutral-100">
              <Ionicons name="receipt-outline" size={28} color="#A3A3A3" />
            </View>
            <Text className="text-base font-semibold text-neutral-700">No expenses yet</Text>
            <Text className="text-center text-sm text-neutral-400">
              Tap + to log your first expense.
            </Text>
            <Text className="text-center text-xs text-neutral-300">
              Accommodation costs from your booking will appear here automatically.
            </Text>
          </View>
        ) : (
          <>
            <Text className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-400">
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
          </>
        )}
      </ScrollView>

      {/* ── Section C: FAB ── */}
      <View
        style={{
          position: 'absolute',
          bottom: insets.bottom > 0 ? insets.bottom + 16 : 24,
          right: 20,
        }}
      >
        <Pressable
          onPress={() => setAddSheetVisible(true)}
          className="h-14 w-14 items-center justify-center rounded-full bg-coral-500 active:bg-coral-600"
          style={{
            shadowColor: '#FF6B5B',
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.4,
            shadowRadius: 12,
            elevation: 6,
          }}
        >
          <Ionicons name="add" size={28} color="white" />
        </Pressable>
      </View>

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
