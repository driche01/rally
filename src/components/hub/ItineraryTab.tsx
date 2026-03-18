/**
 * ItineraryTab — F6 Itinerary Builder
 * Day-by-day timeline of itinerary blocks for a trip.
 */
import { useState, useCallback, useMemo } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  Share,
  Text,
  TextInput,
  View,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTrip, useUpdateTrip } from '@/hooks/useTrips';
import {
  useItineraryBlocks,
  useDayRsvps,
  useCreateBlock,
  useUpdateBlock,
  useDeleteBlock,
} from '@/hooks/useItinerary';
import { useRespondents } from '@/hooks/useRespondents';
import {
  buildItineraryDays,
  formatDayLabel,
  formatTime,
  generateIcal,
} from '@/lib/api/itinerary';
import { getShareUrl } from '@/lib/api/trips';
import { useAuthStore } from '@/stores/authStore';
import type { BlockType, ItineraryBlock, ItineraryDay } from '@/types/database';
import type { CreateBlockInput } from '@/lib/api/itinerary';
import { DateRangePicker } from '@/components/DateRangePicker';

// ─── Constants ────────────────────────────────────────────────────────────────

const BLOCK_TYPES: BlockType[] = ['activity', 'meal', 'travel', 'accommodation', 'free_time'];

const BLOCK_TYPE_LABELS: Record<BlockType, string> = {
  activity: 'Activity',
  meal: 'Meal',
  travel: 'Travel',
  accommodation: 'Accommodation',
  free_time: 'Free time',
};

const BLOCK_TYPE_ICONS: Record<BlockType, React.ComponentProps<typeof Ionicons>['name']> = {
  activity: 'bicycle-outline',
  meal: 'restaurant-outline',
  travel: 'car-outline',
  accommodation: 'bed-outline',
  free_time: 'sunny-outline',
};

const BLOCK_TYPE_COLORS: Record<BlockType, { bg: string; text: string; pill: string }> = {
  activity: { bg: 'bg-blue-50', text: 'text-blue-600', pill: 'bg-blue-50' },
  meal: { bg: 'bg-orange-50', text: 'text-orange-600', pill: 'bg-orange-50' },
  travel: { bg: 'bg-purple-50', text: 'text-purple-600', pill: 'bg-purple-50' },
  accommodation: { bg: 'bg-coral-50', text: 'text-coral-600', pill: 'bg-coral-50' },
  free_time: { bg: 'bg-green-50', text: 'text-green-600', pill: 'bg-green-50' },
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface BlockEditorState {
  visible: boolean;
  mode: 'create' | 'edit';
  dayDate: string;
  block: ItineraryBlock | null;
  title: string;
  type: BlockType;
  startTime: string;
  endTime: string;
  location: string;
  notes: string;
}

const DEFAULT_EDITOR: BlockEditorState = {
  visible: false,
  mode: 'create',
  dayDate: '',
  block: null,
  title: '',
  type: 'activity',
  startTime: '',
  endTime: '',
  location: '',
  notes: '',
};

// ─── Date validation ──────────────────────────────────────────────────────────

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(s: string): boolean {
  if (!DATE_REGEX.test(s)) return false;
  const d = new Date(s + 'T00:00:00');
  return !isNaN(d.getTime());
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function BlockCard({
  block,
  onLongPress,
}: {
  block: ItineraryBlock;
  onLongPress: () => void;
}) {
  const colors = BLOCK_TYPE_COLORS[block.type];
  const icon = BLOCK_TYPE_ICONS[block.type];
  const label = BLOCK_TYPE_LABELS[block.type];
  const timeRange =
    block.start_time
      ? block.end_time
        ? `${formatTime(block.start_time)} – ${formatTime(block.end_time)}`
        : formatTime(block.start_time)
      : null;
  const attendeeCount =
    block.attendee_ids != null ? block.attendee_ids.length : null;

  return (
    <Pressable
      onLongPress={onLongPress}
      className="mb-2 flex-row items-start gap-3 rounded-2xl bg-white p-3"
      style={{
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.06,
        shadowRadius: 6,
        elevation: 2,
      }}
    >
      {/* Type icon */}
      <View className={`mt-0.5 h-8 w-8 items-center justify-center rounded-xl ${colors.bg}`}>
        <Ionicons name={icon} size={16} color={colors.text.replace('text-', '').includes('coral') ? '#FF6B5B' : undefined} style={colors.text.includes('blue') ? { color: '#2563EB' } : colors.text.includes('orange') ? { color: '#EA580C' } : colors.text.includes('purple') ? { color: '#9333EA' } : colors.text.includes('coral') ? { color: '#FF6B5B' } : { color: '#16A34A' }} />
      </View>

      {/* Content */}
      <View className="flex-1 gap-0.5">
        <Text className="text-sm font-semibold text-neutral-800" numberOfLines={1}>
          {block.title}
        </Text>
        <View className="flex-row flex-wrap items-center gap-1.5">
          <Text className={`text-xs font-medium ${colors.text}`}>{label}</Text>
          {timeRange ? (
            <Text className="text-xs text-neutral-400">{timeRange}</Text>
          ) : null}
          {block.location ? (
            <View className="flex-row items-center gap-0.5">
              <Ionicons name="location-outline" size={10} color="#A3A3A3" />
              <Text className="text-xs text-neutral-400" numberOfLines={1}>
                {block.location}
              </Text>
            </View>
          ) : null}
          {attendeeCount != null ? (
            <View className="flex-row items-center gap-0.5">
              <Ionicons name="people-outline" size={10} color="#A3A3A3" />
              <Text className="text-xs text-neutral-400">{attendeeCount}</Text>
            </View>
          ) : null}
        </View>
      </View>

      <Ionicons name="ellipsis-horizontal" size={14} color="#D4D4D4" />
    </Pressable>
  );
}

function DaySection({
  day,
  onAddBlock,
  onEditBlock,
  isPlanner = true,
}: {
  day: ItineraryDay;
  onAddBlock: (dayDate: string) => void;
  onEditBlock: (block: ItineraryBlock) => void;
  isPlanner?: boolean;
}) {
  const { going, not_sure } = day.rsvpCounts;
  const hasRsvps = going > 0 || not_sure > 0;
  const rsvpLabel = [
    going > 0 ? `${going} going` : '',
    not_sure > 0 ? `${not_sure} not sure` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <View className="mb-5">
      {/* Day header */}
      <View className="mb-2 flex-row items-center justify-between">
        <Text className="text-sm font-bold text-neutral-700">
          {formatDayLabel(day.date)}
        </Text>
        {hasRsvps ? (
          <Text className="text-xs font-medium text-coral-500">{rsvpLabel}</Text>
        ) : null}
      </View>

      {/* Blocks */}
      {day.blocks.length === 0 ? (
        isPlanner ? (
          <Pressable
            onPress={() => onAddBlock(day.date)}
            className="mb-2 items-center justify-center rounded-2xl border-2 border-dashed border-neutral-200 py-4"
          >
            <Ionicons name="add" size={20} color="#D4D4D4" />
          </Pressable>
        ) : (
          <View className="mb-2 items-center justify-center rounded-2xl border-2 border-dashed border-neutral-200 py-4">
            <Text className="text-xs text-neutral-300">Nothing planned yet</Text>
          </View>
        )
      ) : (
        day.blocks.map((block) => (
          <BlockCard
            key={block.id}
            block={block}
            onLongPress={isPlanner ? () => onEditBlock(block) : undefined}
          />
        ))
      )}

      {/* Add block button — planners only */}
      {day.blocks.length > 0 && isPlanner ? (
        <Pressable
          onPress={() => onAddBlock(day.date)}
          className="flex-row items-center gap-1 self-start rounded-xl px-2 py-1.5 active:bg-neutral-100"
        >
          <Ionicons name="add-circle-outline" size={14} color="#A3A3A3" />
          <Text className="text-xs font-medium text-neutral-400">Add block</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

// ─── Block Editor Modal ───────────────────────────────────────────────────────

function BlockEditorModal({
  editor,
  onClose,
  onSave,
  onDelete,
  saving,
  deleting,
}: {
  editor: BlockEditorState;
  onClose: () => void;
  onSave: (state: BlockEditorState) => void;
  onDelete: () => void;
  saving: boolean;
  deleting: boolean;
}) {
  const [state, setState] = useState<BlockEditorState>(editor);

  // Sync when editor changes (re-open)
  useMemo(() => {
    setState(editor);
  }, [editor.visible]);

  const set = useCallback(
    <K extends keyof BlockEditorState>(key: K, value: BlockEditorState[K]) =>
      setState((prev) => ({ ...prev, [key]: value })),
    []
  );

  const canSave = state.title.trim().length > 0;

  return (
    <Modal
      visible={editor.visible}
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
          <Pressable
            onPress={() => {}}
            style={{ backgroundColor: 'white', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, gap: 16 }}
          >
            {/* Drag handle */}
            <View style={{ alignItems: 'center', marginBottom: 4 }}>
              <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: '#E5E5E5' }} />
            </View>

            <Text style={{ fontSize: 17, fontWeight: '700', color: '#1C1C1C' }}>
              {editor.mode === 'create' ? 'Add block' : 'Edit block'}
            </Text>

            {/* Type selector */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {BLOCK_TYPES.map((t) => {
                  const active = state.type === t;
                  return (
                    <Pressable
                      key={t}
                      onPress={() => set('type', t)}
                      style={{
                        paddingHorizontal: 12,
                        paddingVertical: 6,
                        borderRadius: 20,
                        borderWidth: 1.5,
                        borderColor: active ? '#FF6B5B' : '#E5E5E5',
                        backgroundColor: active ? '#FFF1F0' : 'white',
                      }}
                    >
                      <Text style={{ fontSize: 13, fontWeight: '600', color: active ? '#FF6B5B' : '#737373' }}>
                        {BLOCK_TYPE_LABELS[t]}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>

            {/* Title */}
            <View>
              <Text style={{ fontSize: 12, fontWeight: '600', color: '#737373', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>Title *</Text>
              <TextInput
                value={state.title}
                onChangeText={(v) => set('title', v)}
                placeholder="e.g. Dinner at The Bistro"
                placeholderTextColor="#A3A3A3"
                style={{ borderWidth: 1.5, borderColor: '#E5E5E5', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: '#1C1C1C' }}
                autoFocus={editor.mode === 'create'}
                maxLength={100}
              />
            </View>

            {/* Times */}
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 12, fontWeight: '600', color: '#737373', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>Start time</Text>
                <TextInput
                  value={state.startTime}
                  onChangeText={(v) => set('startTime', v)}
                  placeholder="HH:MM"
                  placeholderTextColor="#A3A3A3"
                  style={{ borderWidth: 1.5, borderColor: '#E5E5E5', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: '#1C1C1C' }}
                  maxLength={5}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 12, fontWeight: '600', color: '#737373', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>End time</Text>
                <TextInput
                  value={state.endTime}
                  onChangeText={(v) => set('endTime', v)}
                  placeholder="HH:MM"
                  placeholderTextColor="#A3A3A3"
                  style={{ borderWidth: 1.5, borderColor: '#E5E5E5', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: '#1C1C1C' }}
                  maxLength={5}
                />
              </View>
            </View>

            {/* Location */}
            <View>
              <Text style={{ fontSize: 12, fontWeight: '600', color: '#737373', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>Location</Text>
              <TextInput
                value={state.location}
                onChangeText={(v) => set('location', v)}
                placeholder="Address or place name"
                placeholderTextColor="#A3A3A3"
                style={{ borderWidth: 1.5, borderColor: '#E5E5E5', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: '#1C1C1C' }}
                maxLength={200}
              />
            </View>

            {/* Notes */}
            <View>
              <Text style={{ fontSize: 12, fontWeight: '600', color: '#737373', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>Notes</Text>
              <TextInput
                value={state.notes}
                onChangeText={(v) => set('notes', v)}
                placeholder="Any details…"
                placeholderTextColor="#A3A3A3"
                multiline
                numberOfLines={2}
                style={{ borderWidth: 1.5, borderColor: '#E5E5E5', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: '#1C1C1C', minHeight: 72, textAlignVertical: 'top' }}
                maxLength={500}
              />
            </View>

            {/* Actions */}
            <View style={{ flexDirection: 'row', gap: 10 }}>
              {editor.mode === 'edit' ? (
                <Pressable
                  onPress={onDelete}
                  disabled={deleting}
                  style={{ flex: 1, paddingVertical: 14, borderRadius: 14, borderWidth: 1.5, borderColor: '#FCA5A5', alignItems: 'center', justifyContent: 'center' }}
                >
                  {deleting ? (
                    <ActivityIndicator size="small" color="#EF4444" />
                  ) : (
                    <Text style={{ fontSize: 15, fontWeight: '600', color: '#EF4444' }}>Delete</Text>
                  )}
                </Pressable>
              ) : (
                <Pressable
                  onPress={onClose}
                  style={{ flex: 1, paddingVertical: 14, borderRadius: 14, borderWidth: 1.5, borderColor: '#E5E5E5', alignItems: 'center' }}
                >
                  <Text style={{ fontSize: 15, fontWeight: '600', color: '#525252' }}>Cancel</Text>
                </Pressable>
              )}

              <Pressable
                onPress={() => canSave && onSave(state)}
                disabled={!canSave || saving}
                style={{ flex: 2, paddingVertical: 14, borderRadius: 14, backgroundColor: canSave ? '#FF6B5B' : '#FCA99F', alignItems: 'center', justifyContent: 'center' }}
              >
                {saving ? (
                  <ActivityIndicator size="small" color="white" />
                ) : (
                  <Text style={{ fontSize: 15, fontWeight: '600', color: 'white' }}>
                    {editor.mode === 'create' ? 'Add block' : 'Save changes'}
                  </Text>
                )}
              </Pressable>
            </View>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}


// ─── Main Component ───────────────────────────────────────────────────────────

export function ItineraryTab({ tripId, isPlanner = true }: { tripId: string; isPlanner?: boolean }) {
  const insets = useSafeAreaInsets();
  const session = useAuthStore((s) => s.session);

  const { data: trip } = useTrip(tripId);
  const { data: blocks = [] } = useItineraryBlocks(tripId);
  const { data: rsvps = [] } = useDayRsvps(tripId);

  const updateTrip = useUpdateTrip();
  const createBlock = useCreateBlock(tripId);
  const updateBlock = useUpdateBlock(tripId);
  const deleteBlock = useDeleteBlock(tripId);

  const [dateSheetVisible, setDateSheetVisible] = useState(false);
  const [editor, setEditor] = useState<BlockEditorState>(DEFAULT_EDITOR);
  const [deletingBlockId, setDeletingBlockId] = useState<string | null>(null);

  // Build itinerary days
  const days = useMemo(() => {
    if (!trip?.start_date || !trip?.end_date) return [];
    return buildItineraryDays(trip.start_date, trip.end_date, blocks, rsvps);
  }, [trip?.start_date, trip?.end_date, blocks, rsvps]);

  function openAddBlock(dayDate: string) {
    setEditor({
      ...DEFAULT_EDITOR,
      visible: true,
      mode: 'create',
      dayDate,
    });
  }

  function openEditBlock(block: ItineraryBlock) {
    setEditor({
      visible: true,
      mode: 'edit',
      dayDate: block.day_date,
      block,
      title: block.title,
      type: block.type,
      startTime: block.start_time ?? '',
      endTime: block.end_time ?? '',
      location: block.location ?? '',
      notes: block.notes ?? '',
    });
  }

  function closeEditor() {
    setEditor(DEFAULT_EDITOR);
  }

  function handleSaveBlock(state: BlockEditorState) {
    const input: CreateBlockInput = {
      trip_id: tripId,
      day_date: state.dayDate,
      type: state.type,
      title: state.title.trim(),
      start_time: state.startTime.trim() || null,
      end_time: state.endTime.trim() || null,
      location: state.location.trim() || null,
      notes: state.notes.trim() || null,
    };

    if (state.mode === 'create') {
      createBlock.mutate(input, {
        onSuccess: () => closeEditor(),
        onError: () => Alert.alert('Error', 'Could not add block. Please try again.'),
      });
    } else if (state.block) {
      updateBlock.mutate(
        { blockId: state.block.id, updates: { ...input } },
        {
          onSuccess: () => closeEditor(),
          onError: () => Alert.alert('Error', 'Could not update block. Please try again.'),
        }
      );
    }
  }

  function handleDeleteBlock() {
    if (!editor.block) return;
    const blockId = editor.block.id;
    Alert.alert('Delete block?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          setDeletingBlockId(blockId);
          deleteBlock.mutate(blockId, {
            onSuccess: () => {
              setDeletingBlockId(null);
              closeEditor();
            },
            onError: () => {
              setDeletingBlockId(null);
              Alert.alert('Error', 'Could not delete block. Please try again.');
            },
          });
        },
      },
    ]);
  }

  function handleSaveDates(start: string, end: string) {
    updateTrip.mutate(
      { id: tripId, start_date: start, end_date: end },
      {
        onSuccess: () => setDateSheetVisible(false),
        onError: () => Alert.alert('Error', 'Could not save dates. Please try again.'),
      }
    );
  }

  function handleShare() {
    if (!trip) return;
    const shareUrl = getShareUrl(trip.share_token);
    const icalString = generateIcal(blocks, trip.name);

    Alert.alert('Share itinerary', 'Choose an option', [
      {
        text: 'Export to calendar (.ics)',
        onPress: () => {
          Share.share({
            title: `${trip.name} — Itinerary`,
            message: icalString,
          });
        },
      },
      {
        text: 'Copy share link',
        onPress: () => {
          Share.share({
            title: trip.name,
            message: shareUrl,
            url: shareUrl,
          });
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  const hasDates = Boolean(trip?.start_date && trip?.end_date);

  return (
    <View className="flex-1 bg-neutral-50">
      {/* Header */}
      <View className="flex-row items-center justify-between px-6 pt-4 pb-3">
        <Text className="text-base font-bold text-neutral-800">Itinerary</Text>
        <Pressable onPress={handleShare} className="p-1 active:opacity-60">
          <Ionicons name="share-outline" size={20} color="#737373" />
        </Pressable>
      </View>

      {!hasDates ? (
        /* Empty state — no dates */
        <View className="flex-1 items-center justify-center gap-4 px-8">
          <View className="h-14 w-14 items-center justify-center rounded-2xl bg-coral-50">
            <Ionicons name="calendar-outline" size={28} color="#FF6B5B" />
          </View>
          <Text className="text-base font-semibold text-neutral-800">No trip dates yet</Text>
          <Text className="text-center text-sm text-neutral-500">
            Set your trip start and end dates to build a day-by-day itinerary.
          </Text>
          <Pressable
            onPress={() => setDateSheetVisible(true)}
            className="mt-1 rounded-2xl bg-coral-500 px-6 py-3"
          >
            <Text className="text-sm font-semibold text-white">Set trip dates</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 24 }}
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
        >
          {days.map((day) => (
            <DaySection
              key={day.date}
              day={day}
              onAddBlock={openAddBlock}
              onEditBlock={openEditBlock}
              isPlanner={isPlanner}
            />
          ))}

          {/* Edit dates link */}
          <Pressable
            onPress={() => setDateSheetVisible(true)}
            className="mt-2 flex-row items-center gap-1 self-center"
          >
            <Ionicons name="pencil-outline" size={12} color="#A3A3A3" />
            <Text className="text-xs text-neutral-400">Edit trip dates</Text>
          </Pressable>
        </ScrollView>
      )}

      {/* Block Editor */}
      <BlockEditorModal
        editor={editor}
        onClose={closeEditor}
        onSave={handleSaveBlock}
        onDelete={handleDeleteBlock}
        saving={createBlock.isPending || updateBlock.isPending}
        deleting={deletingBlockId != null}
      />

      {/* Date picker for setting trip start/end dates */}
      <DateRangePicker
        visible={dateSheetVisible}
        startDate={trip?.start_date ?? null}
        endDate={trip?.end_date ?? null}
        title="Trip dates"
        confirmLabel="Save dates"
        allowPastDates
        onConfirm={(start, end) => {
          if (start) handleSaveDates(start, end ?? start);
        }}
        onClose={() => setDateSheetVisible(false)}
      />
    </View>
  );
}
