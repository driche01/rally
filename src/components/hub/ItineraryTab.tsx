/**
 * ItineraryTab — F6 Itinerary Builder
 * Day-by-day timeline of itinerary blocks for a trip.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  Share,
  Text,
  TextInput,
  View,
  KeyboardAvoidingView,
  Linking,
  Platform,
} from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
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
import { lookupRestaurantDetails, type RestaurantDetails } from '@/lib/api/restaurantDetails';
import { useAuthStore } from '@/stores/authStore';
import type { BlockType, ItineraryBlock, ItineraryDay } from '@/types/database';
import type { CreateBlockInput } from '@/lib/api/itinerary';
import { DateRangePicker } from '@/components/DateRangePicker';
import { BlockAlternativesSheet } from '@/components/hub/BlockAlternativesSheet';
import { useAiItineraryDraft, useGenerateAiItinerary } from '@/hooks/useAiItinerary';
import type { AiBlockAlternative } from '@/types/database';

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

const LOADING_MESSAGES = [
  'Analyzing your group\'s preferences…',
  'Planning activities and experiences…',
  'Crafting three distinct options…',
  'Almost ready…',
];

const AI_OPTION_STYLES: Record<string, { accent: string; badge: string }> = {
  Packed:   { accent: '#1A4060', badge: '#D8E4EE' },
  Balanced: { accent: '#235C38', badge: '#DDE8D8' },
  Relaxed:  { accent: '#7A4C1E', badge: '#F2E5D8' },
};

// ─── Time Picker ──────────────────────────────────────────────────────────────

const TP_ITEM_H = 52;
const TP_VISIBLE = 5;
const TP_COL_H = TP_ITEM_H * TP_VISIBLE;

const TP_HOURS = Array.from({ length: 24 }, (_, i) => i);
const TP_MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function parseTimeToIndices(time: string): { hi: number; mi: number } {
  if (!time) return { hi: 8, mi: 0 };
  const parts = time.split(':');
  const h = parseInt(parts[0] ?? '8', 10);
  const mRaw = parseInt(parts[1] ?? '0', 10);
  const hi = isNaN(h) ? 8 : Math.max(0, Math.min(23, h));
  const mi = isNaN(mRaw) ? 0 : Math.max(0, Math.min(11, Math.round(mRaw / 5)));
  return { hi, mi };
}

interface TpColumnProps {
  items: number[];
  initialIndex: number;
  onChange: (idx: number) => void;
}

function TpColumn({ items, initialIndex, onChange }: TpColumnProps) {
  const scrollRef = useRef<ScrollView>(null);
  const [activeIdx, setActiveIdx] = useState(initialIndex);

  useEffect(() => {
    const t = setTimeout(() => {
      scrollRef.current?.scrollTo({ y: initialIndex * TP_ITEM_H, animated: false });
    }, 80);
    return () => clearTimeout(t);
  }, []); // run once on mount

  function handleScrollEnd(e: any) {
    const raw = e.nativeEvent.contentOffset.y / TP_ITEM_H;
    const clamped = Math.max(0, Math.min(Math.round(raw), items.length - 1));
    setActiveIdx(clamped);
    onChange(clamped);
  }

  function handleItemPress(i: number) {
    setActiveIdx(i);
    onChange(i);
    scrollRef.current?.scrollTo({ y: i * TP_ITEM_H, animated: true });
  }

  return (
    <View style={{ width: 72, height: TP_COL_H, overflow: 'hidden' }}>
      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        snapToInterval={TP_ITEM_H}
        decelerationRate="fast"
        onMomentumScrollEnd={handleScrollEnd}
        contentContainerStyle={{ paddingVertical: TP_ITEM_H * 2 }}
      >
        {items.map((v, i) => (
          <Pressable
            key={i}
            onPress={() => handleItemPress(i)}
            style={{ height: TP_ITEM_H, alignItems: 'center', justifyContent: 'center' }}
          >
            <Text
              style={{
                fontSize: 24,
                fontWeight: activeIdx === i ? '700' : '400',
                color: activeIdx === i ? '#1C1C1C' : '#C8C8C8',
              }}
            >
              {pad2(v)}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

interface InlineTimePickerProps {
  field: 'start' | 'end';
  initialTime: string;
  onConfirm: (time: string) => void;
  onClear: () => void;
  onBack: () => void;
}

function InlineTimePicker({ field, initialTime, onConfirm, onClear, onBack }: InlineTimePickerProps) {
  const { hi, mi } = parseTimeToIndices(initialTime);
  const hourIdxRef = useRef(hi);
  const minIdxRef = useRef(mi);

  return (
    <View>
      {/* Back header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 20 }}>
        <Pressable onPress={onBack} hitSlop={8} style={{ padding: 2 }}>
          <Ionicons name="chevron-back" size={22} color="#737373" />
        </Pressable>
        <Text style={{ flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '700', color: '#1C1C1C' }}>
          {field === 'start' ? 'Start time' : 'End time'}
        </Text>
        <View style={{ width: 30 }} />
      </View>

      {/* Drum wheel */}
      <View style={{ alignItems: 'center' }}>
        <View style={{ position: 'relative' }}>
          {/* Selection highlight band */}
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: (TP_COL_H - TP_ITEM_H) / 2,
              left: -24,
              right: -24,
              height: TP_ITEM_H,
              backgroundColor: '#F4F4F2',
              borderRadius: 14,
            }}
          />
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <TpColumn
              items={TP_HOURS}
              initialIndex={hi}
              onChange={(idx) => { hourIdxRef.current = idx; }}
            />
            <Text style={{ fontSize: 28, fontWeight: '700', color: '#1C1C1C', width: 22, textAlign: 'center', marginBottom: 3 }}>
              :
            </Text>
            <TpColumn
              items={TP_MINUTES}
              initialIndex={mi}
              onChange={(idx) => { minIdxRef.current = idx; }}
            />
          </View>
        </View>
      </View>

      <Pressable
        onPress={() => {
          const time = `${pad2(TP_HOURS[hourIdxRef.current])}:${pad2(TP_MINUTES[minIdxRef.current])}`;
          onConfirm(time);
        }}
        style={{
          backgroundColor: '#D85A30',
          borderRadius: 14,
          paddingVertical: 14,
          alignItems: 'center',
          marginTop: 20,
        }}
      >
        <Text style={{ fontSize: 15, fontWeight: '700', color: 'white' }}>Confirm</Text>
      </Pressable>

      <Pressable onPress={onClear} style={{ marginTop: 12, alignItems: 'center' }}>
        <Text style={{ fontSize: 14, color: '#A3A3A3' }}>Clear time</Text>
      </Pressable>
    </View>
  );
}

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
  onPress,
  onLongPress,
}: {
  block: ItineraryBlock;
  onPress: (() => void) | undefined;
  onLongPress?: (() => void) | undefined;
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
      onPress={onPress}
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
        <Ionicons name={icon} size={16} color={colors.text.replace('text-', '').includes('coral') ? '#D85A30' : undefined} style={colors.text.includes('blue') ? { color: '#2563EB' } : colors.text.includes('orange') ? { color: '#EA580C' } : colors.text.includes('purple') ? { color: '#9333EA' } : colors.text.includes('coral') ? { color: '#D85A30' } : { color: '#16A34A' }} />
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

      <Ionicons name="chevron-forward" size={14} color="#D4D4D4" />
    </Pressable>
  );
}

function DaySection({
  day,
  onAddBlock,
  onEditBlock,
  onDeleteBlock,
  onLongPressBlock,
  isPlanner = true,
}: {
  day: ItineraryDay;
  onAddBlock: (dayDate: string) => void;
  onEditBlock: (block: ItineraryBlock) => void;
  onDeleteBlock: (block: ItineraryBlock) => void;
  onLongPressBlock: (block: ItineraryBlock) => void;
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
            className="mb-2 items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-neutral-200 py-5"
          >
            <Ionicons name="add-circle-outline" size={18} color="#D4D4D4" />
            <Text style={{ fontSize: 12, color: '#D0D0D0' }}>Tap to add activities</Text>
          </Pressable>
        ) : (
          <View className="mb-2 items-center justify-center rounded-2xl border-2 border-dashed border-neutral-200 py-4">
            <Text className="text-xs text-neutral-300">Nothing planned yet</Text>
          </View>
        )
      ) : (
        day.blocks.map((block) => (
          isPlanner ? (
            <Swipeable
              key={block.id}
              overshootRight={false}
              renderRightActions={() => (
                <Pressable
                  onPress={() => onDeleteBlock(block)}
                  style={{
                    backgroundColor: '#EF4444',
                    justifyContent: 'center',
                    alignItems: 'center',
                    width: 72,
                    borderRadius: 16,
                    marginBottom: 8,
                    marginLeft: 6,
                  }}
                >
                  <Ionicons name="trash-outline" size={18} color="white" />
                  <Text style={{ color: 'white', fontSize: 10, fontWeight: '700', marginTop: 3 }}>Delete</Text>
                </Pressable>
              )}
            >
              <BlockCard
                block={block}
                onPress={() => onEditBlock(block)}
                onLongPress={() => onLongPressBlock(block)}
              />
            </Swipeable>
          ) : (
            <BlockCard
              key={block.id}
              block={block}
              onPress={undefined}
            />
          )
        ))
      )}

      {/* Add block button — planners only, when day has blocks */}
      {day.blocks.length > 0 && isPlanner ? (
        <Pressable
          onPress={() => onAddBlock(day.date)}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            paddingVertical: 10,
            borderRadius: 12,
            borderWidth: 2,
            borderStyle: 'dashed',
            borderColor: '#E5E5E5',
            marginTop: 4,
          }}
        >
          <Ionicons name="add-circle-outline" size={14} color="#D4D4D4" />
          <Text style={{ fontSize: 12, color: '#D0D0D0' }}>Add block</Text>
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
  const [timePickerFor, setTimePickerFor] = useState<'start' | 'end' | null>(null);
  const [tpKey, setTpKey] = useState(0);
  const [restaurantInfo, setRestaurantInfo] = useState<RestaurantDetails | null>(null);
  const [restaurantLoading, setRestaurantLoading] = useState(false);

  useMemo(() => {
    setState(editor);
    setTimePickerFor(null);
    setRestaurantInfo(null);
    setRestaurantLoading(false);
  }, [editor.visible]);

  async function handleLookupRestaurant() {
    if (!state.title.trim() && !state.location.trim()) return;
    setRestaurantLoading(true);
    setRestaurantInfo(null);
    const result = await lookupRestaurantDetails(
      state.title,
      state.location,
      editor.dayDate ?? '',
    );
    setRestaurantLoading(false);
    if (result.found) setRestaurantInfo(result);
  }

  const set = useCallback(
    <K extends keyof BlockEditorState>(key: K, value: BlockEditorState[K]) =>
      setState((prev) => ({ ...prev, [key]: value })),
    []
  );

  function openTimePicker(field: 'start' | 'end') {
    setTimePickerFor(field);
    setTpKey((k) => k + 1);
  }

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
            style={{
              backgroundColor: 'white',
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              padding: 24,
              gap: timePickerFor ? 0 : 16,
            }}
          >
            {/* Drag handle */}
            <View style={{ alignItems: 'center', marginBottom: timePickerFor ? 0 : 4 }}>
              <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: '#E5E5E5' }} />
            </View>

            {timePickerFor !== null ? (
              <InlineTimePicker
                key={tpKey}
                field={timePickerFor}
                initialTime={timePickerFor === 'start' ? state.startTime : state.endTime}
                onConfirm={(time) => {
                  set(timePickerFor === 'start' ? 'startTime' : 'endTime', time);
                  setTimePickerFor(null);
                }}
                onClear={() => {
                  set(timePickerFor === 'start' ? 'startTime' : 'endTime', '');
                  setTimePickerFor(null);
                }}
                onBack={() => setTimePickerFor(null)}
              />
            ) : (
              <>
                {/* Title + day label */}
                <View style={{ gap: 2 }}>
                  <Text style={{ fontSize: 17, fontWeight: '700', color: '#1C1C1C' }}>
                    {editor.mode === 'create' ? 'Add block' : 'Edit block'}
                  </Text>
                  {editor.dayDate ? (
                    <Text style={{ fontSize: 13, color: '#A3A3A3' }}>
                      {formatDayLabel(editor.dayDate)}
                    </Text>
                  ) : null}
                </View>

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
                            borderColor: active ? '#D85A30' : '#E5E5E5',
                            backgroundColor: active ? '#FFF1F0' : 'white',
                          }}
                        >
                          <Text style={{ fontSize: 13, fontWeight: '600', color: active ? '#D85A30' : '#737373' }}>
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

                {/* Times — tappable, open drum picker */}
                <View style={{ flexDirection: 'row', gap: 12 }}>
                  <Pressable
                    onPress={() => openTimePicker('start')}
                    style={{ flex: 1, borderWidth: 1.5, borderColor: '#E5E5E5', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12 }}
                  >
                    <Text style={{ fontSize: 11, fontWeight: '600', color: '#A3A3A3', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
                      Start time
                    </Text>
                    <Text style={{ fontSize: 15, color: state.startTime ? '#1C1C1C' : '#C8C8C8', fontWeight: state.startTime ? '500' : '400' }}>
                      {state.startTime ? formatTime(state.startTime) : 'Set time'}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => openTimePicker('end')}
                    style={{ flex: 1, borderWidth: 1.5, borderColor: '#E5E5E5', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12 }}
                  >
                    <Text style={{ fontSize: 11, fontWeight: '600', color: '#A3A3A3', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
                      End time
                    </Text>
                    <Text style={{ fontSize: 15, color: state.endTime ? '#1C1C1C' : '#C8C8C8', fontWeight: state.endTime ? '500' : '400' }}>
                      {state.endTime ? formatTime(state.endTime) : 'Set time'}
                    </Text>
                  </Pressable>
                </View>

                {/* Location */}
                <View>
                  <Text style={{ fontSize: 12, fontWeight: '600', color: '#737373', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>Location</Text>
                  <TextInput
                    value={state.location}
                    onChangeText={(v) => { set('location', v); setRestaurantInfo(null); }}
                    placeholder="Address or place name"
                    placeholderTextColor="#A3A3A3"
                    style={{ borderWidth: 1.5, borderColor: '#E5E5E5', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: '#1C1C1C' }}
                    maxLength={200}
                  />
                </View>

                {/* Restaurant lookup — meal blocks only */}
                {state.type === 'meal' ? (
                  <View style={{ gap: 10 }}>
                    {/* Look up button */}
                    {!restaurantInfo ? (
                      <Pressable
                        onPress={handleLookupRestaurant}
                        disabled={restaurantLoading || (!state.title.trim() && !state.location.trim())}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 6,
                          paddingVertical: 10,
                          borderRadius: 12,
                          borderWidth: 1.5,
                          borderColor: restaurantLoading ? '#E5E5E5' : '#D85A30',
                          backgroundColor: restaurantLoading ? '#F9F9F9' : '#FFF1F0',
                        }}
                      >
                        {restaurantLoading ? (
                          <ActivityIndicator size="small" color="#D85A30" />
                        ) : (
                          <Ionicons name="storefront-outline" size={15} color="#D85A30" />
                        )}
                        <Text style={{ fontSize: 13, fontWeight: '600', color: restaurantLoading ? '#A3A3A3' : '#D85A30' }}>
                          {restaurantLoading ? 'Looking up…' : 'Look up restaurant info'}
                        </Text>
                      </Pressable>
                    ) : (
                      /* Restaurant info card */
                      <View style={{ backgroundColor: '#FFF8F7', borderRadius: 14, borderWidth: 1.5, borderColor: '#FFD5CF', padding: 14, gap: 10 }}>
                        {/* Name + dismiss */}
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                          <Text style={{ fontSize: 14, fontWeight: '700', color: '#1C1C1C', flex: 1 }} numberOfLines={1}>
                            {restaurantInfo.name}
                          </Text>
                          <Pressable onPress={() => setRestaurantInfo(null)} hitSlop={8}>
                            <Ionicons name="close-circle" size={18} color="#C8C8C8" />
                          </Pressable>
                        </View>

                        {/* Price + hours row */}
                        <View style={{ flexDirection: 'row', gap: 16 }}>
                          {restaurantInfo.price_display ? (
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                              <Ionicons name="cash-outline" size={13} color="#737373" />
                              <Text style={{ fontSize: 13, color: '#525252', fontWeight: '600' }}>
                                {restaurantInfo.price_display}
                              </Text>
                            </View>
                          ) : null}
                          {restaurantInfo.hours_today ? (
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                              <Ionicons name="time-outline" size={13} color="#737373" />
                              <Text style={{ fontSize: 13, color: '#525252' }}>
                                {restaurantInfo.hours_today.all_day
                                  ? 'Open 24 hrs'
                                  : `${restaurantInfo.hours_today.open} – ${restaurantInfo.hours_today.close}`}
                              </Text>
                            </View>
                          ) : null}
                        </View>

                        {/* Google Maps link */}
                        {restaurantInfo.google_maps_url ? (
                          <Pressable
                            onPress={() => Linking.openURL(restaurantInfo.google_maps_url!)}
                            style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}
                          >
                            <Ionicons name="map-outline" size={13} color="#D85A30" />
                            <Text style={{ fontSize: 13, color: '#D85A30', fontWeight: '600' }}>
                              View on Google Maps
                            </Text>
                            <Ionicons name="open-outline" size={11} color="#D85A30" />
                          </Pressable>
                        ) : null}
                      </View>
                    )}
                  </View>
                ) : null}

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
                    style={{ flex: 2, paddingVertical: 14, borderRadius: 14, backgroundColor: canSave ? '#D85A30' : '#FCA99F', alignItems: 'center', justifyContent: 'center' }}
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
              </>
            )}
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}


// ─── AI Itinerary Banner ──────────────────────────────────────────────────────

function AiItineraryBanner({
  tripId,
  blocksEmpty,
  isPlanner,
}: {
  tripId: string;
  blocksEmpty: boolean;
  isPlanner: boolean;
}) {
  const router = useRouter();
  const { data: draft } = useAiItineraryDraft(tripId);
  const generate = useGenerateAiItinerary(tripId);
  const [loadingMsgIdx, setLoadingMsgIdx] = useState(0);

  if (!isPlanner) return null;

  const isGenerating = draft?.status === 'generating' || generate.isPending;
  const hasReadyOptions = draft?.status === 'ready' && (draft.options?.length ?? 0) > 0 && !draft.applied_at;
  const wasApplied = Boolean(draft?.applied_at);

  useEffect(() => {
    if (!isGenerating) {
      setLoadingMsgIdx(0);
      return;
    }
    const id = setInterval(() => {
      setLoadingMsgIdx((i) => (i + 1) % LOADING_MESSAGES.length);
    }, 3500);
    return () => clearInterval(id);
  }, [isGenerating]);

  // Post-apply: prominent banner showing applied option + regenerate link
  if (wasApplied) {
    const appliedLabel =
      draft?.selected_index != null
        ? (draft.options?.[draft.selected_index]?.label ?? 'Balanced')
        : 'Balanced';
    const appliedStyle = AI_OPTION_STYLES[appliedLabel] ?? AI_OPTION_STYLES.Balanced;

    return (
      <Pressable
        onPress={() => router.push(`/(app)/trips/${tripId}/ai-itinerary` as any)}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          backgroundColor: appliedStyle.badge,
          borderRadius: 14,
          paddingHorizontal: 14,
          paddingVertical: 12,
          marginBottom: 16,
          borderWidth: 1,
          borderColor: appliedStyle.accent + '30',
        }}
        accessibilityRole="button"
      >
        <Ionicons name="sparkles" size={16} color={appliedStyle.accent} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 13, fontWeight: '700', color: appliedStyle.accent }}>
            {appliedLabel} itinerary applied
          </Text>
          <Text style={{ fontSize: 11, color: appliedStyle.accent, opacity: 0.75, marginTop: 1 }}>
            AI-generated · tap any block to edit
          </Text>
        </View>
        <View
          style={{
            backgroundColor: appliedStyle.accent + '18',
            borderRadius: 8,
            paddingHorizontal: 8,
            paddingVertical: 4,
          }}
        >
          <Text style={{ fontSize: 11, fontWeight: '600', color: appliedStyle.accent }}>
            Regenerate
          </Text>
        </View>
      </Pressable>
    );
  }

  // Generating spinner with animated messages
  if (isGenerating) {
    return (
      <View style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        backgroundColor: '#EEF3F8',
        borderRadius: 16,
        paddingHorizontal: 16,
        paddingVertical: 14,
        marginBottom: 16,
        borderWidth: 1,
        borderColor: '#D8E4EE',
      }}>
        <ActivityIndicator size="small" color="#1A4060" />
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 14, fontWeight: '600', color: '#1A4060' }}>
            {LOADING_MESSAGES[loadingMsgIdx]}
          </Text>
          <Text style={{ fontSize: 12, color: '#4A6E8A', marginTop: 2 }}>
            About 15–30 seconds
          </Text>
        </View>
      </View>
    );
  }

  // Options are ready — prompt the planner to review them
  if (hasReadyOptions) {
    return (
      <Pressable
        onPress={() => router.push(`/(app)/trips/${tripId}/ai-itinerary` as any)}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          backgroundColor: '#EEF3F8',
          borderRadius: 16,
          paddingHorizontal: 16,
          paddingVertical: 14,
          marginBottom: 16,
          borderWidth: 1,
          borderColor: '#1A4060',
        }}
        accessibilityRole="button"
      >
        <Ionicons name="sparkles" size={20} color="#1A4060" />
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 14, fontWeight: '700', color: '#1A4060' }}>
            3 itinerary options ready
          </Text>
          <Text style={{ fontSize: 12, color: '#4A6E8A', marginTop: 2 }}>
            Tap to pick one and apply it →
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color="#1A4060" />
      </Pressable>
    );
  }

  // No draft yet + no blocks — show the generate CTA
  if (blocksEmpty) {
    return (
      <View style={{
        backgroundColor: '#EEF3F8',
        borderRadius: 16,
        padding: 16,
        marginBottom: 16,
        borderWidth: 1,
        borderColor: '#D8E4EE',
        gap: 10,
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Ionicons name="sparkles-outline" size={18} color="#1A4060" />
          <Text style={{ fontSize: 14, fontWeight: '700', color: '#1A4060' }}>
            Generate AI itinerary options
          </Text>
        </View>
        <Text style={{ fontSize: 13, color: '#4A6E8A', lineHeight: 18 }}>
          Rally will create 3 tailored options based on your group's confirmed preferences and trip details.
        </Text>
        <Pressable
          onPress={() => generate.mutate({})}
          style={{
            backgroundColor: '#1A4060',
            borderRadius: 12,
            paddingVertical: 12,
            alignItems: 'center',
          }}
          accessibilityRole="button"
        >
          <Text style={{ fontSize: 14, fontWeight: '700', color: '#FFFFFF' }}>
            Generate options
          </Text>
        </Pressable>
      </View>
    );
  }

  return null;
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
  const [altSheetBlock, setAltSheetBlock] = useState<ItineraryBlock | null>(null);
  const [applyingAlt, setApplyingAlt] = useState(false);

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

  function handleSwipeDelete(block: ItineraryBlock) {
    deleteBlock.mutate(block.id, {
      onError: () => Alert.alert('Error', 'Could not delete block. Please try again.'),
    });
  }

  function handleApplyBlockAlt(alt: AiBlockAlternative) {
    if (!altSheetBlock) return;
    setApplyingAlt(true);
    updateBlock.mutate(
      {
        blockId: altSheetBlock.id,
        updates: {
          title: alt.title,
          type: alt.type as BlockType,
          start_time: alt.start_time,
          end_time: alt.end_time,
          location: alt.location,
          notes: alt.notes,
        },
      },
      {
        onSuccess: () => {
          setApplyingAlt(false);
          setAltSheetBlock(null);
        },
        onError: () => {
          setApplyingAlt(false);
          Alert.alert('Error', 'Could not apply change. Please try again.');
        },
      }
    );
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

  function buildShareText(): string {
    if (!trip) return '';

    const BLOCK_EMOJI: Record<string, string> = {
      activity:      '🚵',
      meal:          '🍽️',
      travel:        '🚗',
      accommodation: '🏠',
      free_time:     '☀️',
    };

    // `days` is the memoized itinerary already built by the component

    // Header
    const dateRange = trip.start_date && trip.end_date
      ? (() => {
          const [sy, sm, sd] = trip.start_date.split('-').map(Number);
          const [ey, em, ed] = trip.end_date.split('-').map(Number);
          const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
          const start = `${months[sm - 1]} ${sd}`;
          const end = sm === em ? `${ed}` : `${months[em - 1]} ${ed}`;
          return `${start}–${end}`;
        })()
      : '';

    const lines: string[] = [
      `✈️ ${trip.name}`,
      dateRange ? `📅 ${dateRange}` : '',
      '',
    ].filter((l, i) => i < 2 || l !== '');

    for (const day of days) {
      if (!day.blocks.length) continue;
      lines.push(`── ${formatDayLabel(day.date)} ──`);
      for (const block of day.blocks) {
        const emoji = BLOCK_EMOJI[block.type] ?? '📌';
        const time = block.start_time
          ? block.end_time
            ? `${formatTime(block.start_time)} – ${formatTime(block.end_time)}`
            : formatTime(block.start_time)
          : '';
        const location = block.location ? `  📍 ${block.location}` : '';
        lines.push(`${emoji} ${time ? `${time}  ` : ''}${block.title}${location}`);
      }
      lines.push('');
    }

    const shareUrl = getShareUrl(trip.share_token);
    lines.push(`Planned with Rally 🎉`);
    lines.push(shareUrl);

    return lines.join('\n');
  }

  function handleShare() {
    if (!trip) return;
    const msg = buildShareText();
    const encoded = encodeURIComponent(msg);
    Alert.alert('Share itinerary', 'Choose how to send:', [
      { text: 'iMessage / SMS', onPress: () => Linking.openURL(Platform.OS === 'ios' ? `sms:&body=${encoded}` : `sms:?body=${encoded}`) },
      { text: 'WhatsApp', onPress: () => Linking.openURL(`whatsapp://send?text=${encoded}`) },
      { text: 'More options…', onPress: async () => { try { await Share.share({ message: msg }); } catch {} } },
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
            <Ionicons name="calendar-outline" size={28} color="#D85A30" />
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
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 24, paddingTop: 16 }}
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
        >
          <AiItineraryBanner
            tripId={tripId}
            blocksEmpty={blocks.length === 0}
            isPlanner={isPlanner}
          />
          {days.map((day) => (
            <DaySection
              key={day.date}
              day={day}
              onAddBlock={openAddBlock}
              onEditBlock={openEditBlock}
              onDeleteBlock={handleSwipeDelete}
              onLongPressBlock={setAltSheetBlock}
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

          {/* Empty state */}
          {blocks.length === 0 ? (
            <View style={{ alignItems: 'center', paddingVertical: 48, gap: 10 }}>
              <Ionicons name="calendar-outline" size={44} color="#D0D0D0" />
              <Text style={{ fontSize: 16, fontWeight: '600', color: '#1A1A1A' }}>No activities yet</Text>
              <Text style={{ fontSize: 14, color: '#888', textAlign: 'center', lineHeight: 20, paddingHorizontal: 32 }}>
                Tap any day above to start building your itinerary, or use AI to generate options.
              </Text>
            </View>
          ) : null}
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

      {/* AI Block Alternatives Sheet */}
      <BlockAlternativesSheet
        visible={altSheetBlock !== null}
        block={altSheetBlock}
        tripId={tripId}
        onClose={() => setAltSheetBlock(null)}
        onApply={handleApplyBlockAlt}
        applying={applyingAlt}
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
