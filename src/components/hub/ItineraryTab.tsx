/**
 * ItineraryTab — F6 Itinerary Builder
 * Day-by-day timeline of itinerary blocks for a trip.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  Share,
  Text,
  TextInput,
  View,
  Linking,
  Platform,
} from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTrip, useUpdateTrip } from '@/hooks/useTrips';
import { useGoogleSignIn } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { exportItineraryToGoogleCalendar } from '@/lib/api/gcalExport';
import { usePolls } from '@/hooks/usePolls';
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
import { parseDateRangeLabel } from '@/lib/pollFormUtils';
import { getShareUrl } from '@/lib/api/trips';
import { lookupRestaurantDetails, type RestaurantDetails } from '@/lib/api/restaurantDetails';
import { useAuthStore } from '@/stores/authStore';
import type { BlockType, ItineraryBlock, ItineraryDay } from '@/types/database';
import type { CreateBlockInput } from '@/lib/api/itinerary';
import { Button, EmptyState, FormField, Input, Pill, Sheet, Spinner } from '@/components/ui';
import { DateRangePicker } from '@/components/DateRangePicker';
import { BlockAlternativesSheet } from '@/components/hub/BlockAlternativesSheet';
import {
  useAiItineraryDraft,
  useGenerateAiItinerary,
  useApplyAiItineraryOption,
} from '@/hooks/useAiItinerary';
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

// Block-type pill colors. Brand-coherent variants (no blue/purple/coral)
// that still give each type a visually distinct identity:
//   activity      → green-soft   (primary action — "doing stuff")
//   meal          → gold/40      (food reads warmly as gold)
//   travel        → cream-warm   (transit is the "in between")
//   accommodation → green-soft   (sleeping = restful green)
//   free_time     → gold/40      (warm highlight — same as meal,
//                                  acceptable since they're rarely adjacent)
const BLOCK_TYPE_COLORS: Record<BlockType, { bg: string; text: string; pill: string }> = {
  activity:      { bg: 'bg-green-soft', text: 'text-green-dark', pill: 'bg-green-soft' },
  meal:          { bg: 'bg-gold/40',    text: 'text-ink',         pill: 'bg-gold/40' },
  travel:        { bg: 'bg-cream-warm', text: 'text-ink',         pill: 'bg-cream-warm' },
  accommodation: { bg: 'bg-green-soft', text: 'text-green-dark', pill: 'bg-green-soft' },
  free_time:     { bg: 'bg-gold/40',   text: 'text-ink',  pill: 'bg-gold/40' },
};

const LOADING_MESSAGES = [
  'Analyzing your group\'s preferences…',
  'Planning activities and experiences…',
  'Crafting three distinct options…',
  'Almost ready…',
];

// ─── Time Picker ──────────────────────────────────────────────────────────────

const TP_ITEM_H = 52;
const TP_VISIBLE = 5;
const TP_COL_H = TP_ITEM_H * TP_VISIBLE;

const TP_HOURS = Array.from({ length: 24 }, (_, i) => i);
const TP_MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Local-date → 'YYYY-MM-DD'. Mirrors the trips-table format so derived
 *  itinerary dates use the same string shape as canonical trip.start_date. */
function toIsoDay(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
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
                color: activeIdx === i ? '#163026' : '#9DA8A0',
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
          <Ionicons name="chevron-back" size={22} color="#5F685F" />
        </Pressable>
        <Text style={{ flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '700', color: '#163026' }}>
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
              backgroundColor: '#EFE3D0',
              borderRadius: 14,
            }}
          />
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <TpColumn
              items={TP_HOURS}
              initialIndex={hi}
              onChange={(idx) => { hourIdxRef.current = idx; }}
            />
            <Text style={{ fontSize: 28, fontWeight: '700', color: '#163026', width: 22, textAlign: 'center', marginBottom: 3 }}>
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
          backgroundColor: '#0F3F2E',
          borderRadius: 14,
          paddingVertical: 14,
          alignItems: 'center',
          marginTop: 20,
        }}
      >
        <Text style={{ fontSize: 15, fontWeight: '700', color: 'white' }}>Confirm</Text>
      </Pressable>

      <Pressable onPress={onClear} style={{ marginTop: 12, alignItems: 'center' }}>
        <Text style={{ fontSize: 14, color: '#9DA8A0' }}>Clear time</Text>
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
      className="mb-2 flex-row items-start gap-3 rounded-2xl bg-card p-3"
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
        <Ionicons name={icon} size={16} color={colors.text.replace('text-', '').includes('coral') ? '#0F3F2E' : undefined} style={colors.text.includes('blue') ? { color: '#0F3F2E' } : colors.text.includes('orange') ? { color: '#7A4C1E' } : colors.text.includes('purple') ? { color: '#0F3F2E' } : colors.text.includes('coral') ? { color: '#0F3F2E' } : { color: '#0F3F2E' }} />
      </View>

      {/* Content */}
      <View className="flex-1 gap-0.5">
        <Text className="text-sm font-semibold text-ink" numberOfLines={1}>
          {block.title}
        </Text>
        <View className="flex-row flex-wrap items-center gap-1.5">
          <Text className={`text-xs font-medium ${colors.text}`}>{label}</Text>
          {timeRange ? (
            <Text className="text-xs text-muted">{timeRange}</Text>
          ) : null}
          {block.location ? (
            <View className="flex-row items-center gap-0.5">
              <Ionicons name="location-outline" size={10} color="#9DA8A0" />
              <Text className="text-xs text-muted" numberOfLines={1}>
                {block.location}
              </Text>
            </View>
          ) : null}
          {attendeeCount != null ? (
            <View className="flex-row items-center gap-0.5">
              <Ionicons name="people-outline" size={10} color="#9DA8A0" />
              <Text className="text-xs text-muted">{attendeeCount}</Text>
            </View>
          ) : null}
        </View>
      </View>

      <Ionicons name="chevron-forward" size={14} color="#9DA8A0" />
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
        <Text className="text-sm font-bold text-ink">
          {formatDayLabel(day.date)}
        </Text>
        {hasRsvps ? (
          <Text className="text-xs font-medium text-green">{rsvpLabel}</Text>
        ) : null}
      </View>

      {/* Blocks */}
      {day.blocks.length === 0 ? (
        isPlanner ? (
          <Pressable
            onPress={() => onAddBlock(day.date)}
            className="mb-2 items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-line py-5"
          >
            <Ionicons name="add-circle-outline" size={18} color="#9DA8A0" />
            <Text style={{ fontSize: 12, color: '#9DA8A0' }}>Tap to add activities</Text>
          </Pressable>
        ) : (
          <View className="mb-2 items-center justify-center rounded-2xl border-2 border-dashed border-line py-4">
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
            borderColor: '#D9CCB6',
            marginTop: 4,
          }}
        >
          <Ionicons name="add-circle-outline" size={14} color="#9DA8A0" />
          <Text style={{ fontSize: 12, color: '#9DA8A0' }}>Add block</Text>
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
    <Sheet
      visible={editor.visible}
      onClose={onClose}
      title={timePickerFor ? undefined : (editor.mode === 'create' ? 'Add block' : 'Edit block')}
      subtitle={timePickerFor ? undefined : (editor.dayDate ? formatDayLabel(editor.dayDate) : undefined)}
    >
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
          {/* Type selector */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }}>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {BLOCK_TYPES.map((t) => (
                <Pill
                  key={t}
                  onPress={() => set('type', t)}
                  selected={state.type === t}
                  size="sm"
                >
                  {BLOCK_TYPE_LABELS[t]}
                </Pill>
              ))}
            </View>
          </ScrollView>

          {/* Title */}
          <FormField label="Title" required>
            <Input
              value={state.title}
              onChangeText={(v) => set('title', v)}
              placeholder="e.g. Dinner at The Bistro"
              autoFocus={editor.mode === 'create'}
              maxLength={100}
            />
          </FormField>

          {/* Times — tappable, open drum picker */}
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <Pressable
              onPress={() => openTimePicker('start')}
              style={{ flex: 1, borderWidth: 1, borderColor: '#D9CCB6', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: '#FFFCF6' }}
            >
              <Text style={{ fontSize: 11, fontWeight: '600', color: '#9DA8A0', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
                Start time
              </Text>
              <Text style={{ fontSize: 15, color: state.startTime ? '#163026' : '#9DA8A0', fontWeight: state.startTime ? '500' : '400' }}>
                {state.startTime ? formatTime(state.startTime) : 'Set time'}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => openTimePicker('end')}
              style={{ flex: 1, borderWidth: 1, borderColor: '#D9CCB6', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: '#FFFCF6' }}
            >
              <Text style={{ fontSize: 11, fontWeight: '600', color: '#9DA8A0', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
                End time
              </Text>
              <Text style={{ fontSize: 15, color: state.endTime ? '#163026' : '#9DA8A0', fontWeight: state.endTime ? '500' : '400' }}>
                {state.endTime ? formatTime(state.endTime) : 'Set time'}
              </Text>
            </Pressable>
          </View>

          {/* Location */}
          <FormField label="Location">
            <Input
              value={state.location}
              onChangeText={(v) => { set('location', v); setRestaurantInfo(null); }}
              placeholder="Address or place name"
              maxLength={200}
            />
          </FormField>

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
                    borderColor: restaurantLoading ? '#D9CCB6' : '#0F3F2E',
                    backgroundColor: restaurantLoading ? '#EFE3D0' : '#DFE8D2',
                  }}
                >
                  {restaurantLoading ? (
                    <Spinner />
                  ) : (
                    <Ionicons name="storefront-outline" size={15} color="#0F3F2E" />
                  )}
                  <Text style={{ fontSize: 13, fontWeight: '600', color: restaurantLoading ? '#9DA8A0' : '#0F3F2E' }}>
                    {restaurantLoading ? 'Looking up…' : 'Look up restaurant info'}
                  </Text>
                </Pressable>
              ) : (
                      /* Restaurant info card */
                      <View style={{ backgroundColor: '#EFE3D0', borderRadius: 14, borderWidth: 1.5, borderColor: '#D9CCB6', padding: 14, gap: 10 }}>
                        {/* Name + dismiss */}
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                          <Text style={{ fontSize: 14, fontWeight: '700', color: '#163026', flex: 1 }} numberOfLines={1}>
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
                              <Ionicons name="cash-outline" size={13} color="#5F685F" />
                              <Text style={{ fontSize: 13, color: '#525252', fontWeight: '600' }}>
                                {restaurantInfo.price_display}
                              </Text>
                            </View>
                          ) : null}
                          {restaurantInfo.hours_today ? (
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                              <Ionicons name="time-outline" size={13} color="#5F685F" />
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
                            <Ionicons name="map-outline" size={13} color="#0F3F2E" />
                            <Text style={{ fontSize: 13, color: '#0F3F2E', fontWeight: '600' }}>
                              View on Google Maps
                            </Text>
                            <Ionicons name="open-outline" size={11} color="#0F3F2E" />
                          </Pressable>
                        ) : null}
                      </View>
                    )}
                  </View>
                ) : null}

          {/* Notes */}
          <FormField label="Notes">
            <Input
              value={state.notes}
              onChangeText={(v) => set('notes', v)}
              placeholder="Any details…"
              multiline
              maxLength={500}
            />
          </FormField>

          {/* Actions — uses centralized Button so brand updates flow */}
          <Sheet.Actions>
            <View style={{ flex: 1 }}>
              {editor.mode === 'edit' ? (
                <Button
                  variant="destructive"
                  onPress={onDelete}
                  loading={deleting}
                  disabled={deleting}
                  fullWidth
                >
                  Delete
                </Button>
              ) : (
                <Button variant="secondary" onPress={onClose} fullWidth>
                  Cancel
                </Button>
              )}
            </View>

            <View style={{ flex: 2 }}>
              <Button
                variant="primary"
                onPress={() => canSave && onSave(state)}
                loading={saving}
                disabled={!canSave || saving}
                fullWidth
              >
                {editor.mode === 'create' ? 'Add block' : 'Save changes'}
              </Button>
            </View>
          </Sheet.Actions>
        </>
      )}
    </Sheet>
  );
}


// ─── AI Itinerary Banner ──────────────────────────────────────────────────────

/**
 * AI itinerary auto-pilot. Replaces the previous "generate → pick one of 3"
 * flow with a single auto-applied itinerary the planner can re-roll with
 * an optional steering prompt.
 *
 * Behavior:
 *   - First time the planner opens the itinerary tab on a trip with dates
 *     and no blocks, generation kicks off automatically.
 *   - When the draft becomes ready, the Balanced option (index 1, the
 *     middle of the spectrum the prompt asks for) is applied immediately.
 *   - The banner stays mounted as a control surface: the planner can type
 *     a steering prompt ("more food, less hiking") and tap Regenerate to
 *     re-roll. Regenerate overwrites existing blocks via the same delete-
 *     then-insert path applyAiItineraryOption already uses.
 */
function AiItineraryBanner({
  tripId,
  blocksEmpty,
  hasDates,
  isPlanner,
}: {
  tripId: string;
  blocksEmpty: boolean;
  hasDates: boolean;
  isPlanner: boolean;
}) {
  const { data: draft } = useAiItineraryDraft(tripId);
  const generate = useGenerateAiItinerary(tripId);
  const apply = useApplyAiItineraryOption(tripId);
  const [loadingMsgIdx, setLoadingMsgIdx] = useState(0);
  const [promptDraft, setPromptDraft] = useState('');
  const autoTriggeredFor = useRef<string | null>(null);
  const autoAppliedFor = useRef<string | null>(null);

  const isGenerating = draft?.status === 'generating' || generate.isPending;
  const isApplying = apply.isPending;
  const isError = draft?.status === 'error';
  const wasApplied = Boolean(draft?.applied_at);

  // Auto-trigger generation once per trip when the planner lands on an
  // empty itinerary that has dates set. Skipped if a draft already exists
  // (planner is just revisiting), if blocks have been added manually, or
  // if dates aren't decided yet.
  useEffect(() => {
    if (!isPlanner || !hasDates || !blocksEmpty) return;
    if (autoTriggeredFor.current === tripId) return;
    if (draft) return; // either generating, ready, applied, or errored — let the user drive
    autoTriggeredFor.current = tripId;
    generate.mutate({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId, isPlanner, hasDates, blocksEmpty, draft]);

  // Auto-apply Balanced when a fresh draft becomes ready. The prompt asks
  // Gemini for [Packed, Balanced, Relaxed] in that order; Balanced (index
  // 1) is the safest middle-ground default. The auto-applied ref keys on
  // draft.id so a Regenerate produces a new draft and triggers another
  // auto-apply pass.
  useEffect(() => {
    if (!draft) return;
    if (draft.status !== 'ready') return;
    if (draft.applied_at) return;
    if (autoAppliedFor.current === draft.id) return;
    if (apply.isPending) return;
    const opts = draft.options ?? [];
    if (opts.length === 0) return;
    const balanced = opts.find((o) => o.label === 'Balanced') ?? opts[Math.min(1, opts.length - 1)];
    autoAppliedFor.current = draft.id;
    apply.mutate({ draftId: draft.id, option: balanced });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

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

  if (!isPlanner) return null;
  if (!hasDates) return null;

  function handleRegenerate() {
    const override = promptDraft.trim();
    generate.mutate({ override: override.length > 0 ? override : undefined });
  }

  // Generating / applying — keep the spinner banner active.
  if (isGenerating || isApplying) {
    return (
      <View style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        backgroundColor: '#EFE3D0',
        borderRadius: 16,
        paddingHorizontal: 16,
        paddingVertical: 14,
        marginBottom: 16,
        borderWidth: 1,
        borderColor: '#DDE8D8',
      }}>
        <Spinner />
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 14, fontWeight: '600', color: '#0F3F2E' }}>
            {isApplying ? 'Building your itinerary…' : LOADING_MESSAGES[loadingMsgIdx]}
          </Text>
          <Text style={{ fontSize: 12, color: '#4A6E8A', marginTop: 2 }}>
            About 15–30 seconds
          </Text>
        </View>
      </View>
    );
  }

  // Generation failed — let the planner retry.
  if (isError) {
    return (
      <View style={{
        backgroundColor: '#FEF1EF',
        borderRadius: 16,
        padding: 16,
        marginBottom: 16,
        borderWidth: 1.5,
        borderColor: '#F4C7BD',
        gap: 10,
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Ionicons name="alert-circle" size={18} color="#9A2A2A" />
          <Text style={{ fontSize: 14, fontWeight: '700', color: '#9A2A2A' }}>
            Couldn't generate itinerary
          </Text>
        </View>
        {draft?.error_message ? (
          <Text style={{ fontSize: 12, color: '#78350F' }}>{draft.error_message}</Text>
        ) : null}
        <Button variant="primary" onPress={handleRegenerate} fullWidth>
          Try again
        </Button>
      </View>
    );
  }

  // Auto-applied (or pre-existing) itinerary — show the regenerate
  // surface so the planner can tailor + re-roll without leaving the tab.
  if (wasApplied || !blocksEmpty) {
    return (
      <View style={{
        backgroundColor: '#EFE3D0',
        borderRadius: 16,
        padding: 16,
        marginBottom: 16,
        borderWidth: 1,
        borderColor: '#DDE8D8',
        gap: 10,
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Ionicons name="sparkles" size={16} color="#0F3F2E" />
          <Text style={{ fontSize: 14, fontWeight: '700', color: '#0F3F2E', flex: 1 }}>
            {wasApplied ? 'Itinerary auto-generated for your group' : 'Tune your itinerary'}
          </Text>
        </View>
        <Text style={{ fontSize: 12, color: '#4A6E8A', lineHeight: 17 }}>
          Tap any block to edit. Want a different vibe? Add a note and regenerate.
        </Text>
        <TextInput
          value={promptDraft}
          onChangeText={setPromptDraft}
          placeholder="e.g. more food tours, less hiking, slower mornings"
          placeholderTextColor="#a3a3a3"
          multiline
          maxLength={280}
          style={{
            backgroundColor: 'white',
            borderRadius: 10,
            borderWidth: 1,
            borderColor: '#DDE8D8',
            paddingHorizontal: 12,
            paddingVertical: 10,
            fontSize: 13,
            color: '#163026',
            minHeight: 60,
            textAlignVertical: 'top',
          }}
        />
        <Button variant="primary" onPress={handleRegenerate} fullWidth>
          Regenerate
        </Button>
      </View>
    );
  }

  // Idle (rare — auto-trigger should have fired). Manual fallback CTA.
  return (
    <View style={{
      backgroundColor: '#EFE3D0',
      borderRadius: 16,
      padding: 16,
      marginBottom: 16,
      borderWidth: 1,
      borderColor: '#DDE8D8',
      gap: 10,
    }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Ionicons name="sparkles-outline" size={18} color="#1A4060" />
        <Text style={{ fontSize: 14, fontWeight: '700', color: '#0F3F2E' }}>
          Build your itinerary
        </Text>
      </View>
      <Text style={{ fontSize: 13, color: '#4A6E8A', lineHeight: 18 }}>
        Rally will draft a day-by-day plan from your group's polls and preferences.
      </Text>
      <Button variant="primary" onPress={handleRegenerate} fullWidth>
        Generate itinerary
      </Button>
    </View>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function ItineraryTab({ tripId, isPlanner = true }: { tripId: string; isPlanner?: boolean }) {
  const insets = useSafeAreaInsets();
  const session = useAuthStore((s) => s.session);

  const { data: trip } = useTrip(tripId);
  const { data: blocks = [] } = useItineraryBlocks(tripId);
  const { data: rsvps = [] } = useDayRsvps(tripId);
  const { data: polls = [] } = usePolls(tripId);
  const { data: respondents = [] } = useRespondents(tripId);
  const googleSignIn = useGoogleSignIn();

  const updateTrip = useUpdateTrip();
  const createBlock = useCreateBlock(tripId);
  const updateBlock = useUpdateBlock(tripId);
  const deleteBlock = useDeleteBlock(tripId);

  const [dateSheetVisible, setDateSheetVisible] = useState(false);
  const [editor, setEditor] = useState<BlockEditorState>(DEFAULT_EDITOR);
  const [deletingBlockId, setDeletingBlockId] = useState<string | null>(null);
  const [altSheetBlock, setAltSheetBlock] = useState<ItineraryBlock | null>(null);
  const [applyingAlt, setApplyingAlt] = useState(false);

  // Effective trip dates. Canonical source is trips.start_date / end_date,
  // written by the trip-create flow and by approve_poll_recommendation_with_dates
  // (the date-heatmap "Pick" path). When a planner approves a dates poll
  // via the regular "Approve" button instead, the RPC currently only writes
  // trip_duration — leaving start/end_date null even though the group
  // decided. Fall back to the decided dates poll's option label so the
  // itinerary tab inherits whatever the trip actually decided, instead of
  // asking the planner to re-enter dates a second time.
  const datesPollDecision = useMemo(() => {
    const decided = polls.find((p) =>
      p.type === 'dates' && p.status === 'decided' && p.decided_option_id,
    );
    if (!decided) return null;
    const opt = decided.poll_options.find((o) => o.id === decided.decided_option_id);
    if (!opt) return null;
    return parseDateRangeLabel(opt.label);
  }, [polls]);

  const effectiveStartDate = trip?.start_date ?? (datesPollDecision ? toIsoDay(datesPollDecision.start) : null);
  const effectiveEndDate   = trip?.end_date   ?? (datesPollDecision ? toIsoDay(datesPollDecision.end)   : null);

  // Build itinerary days
  const days = useMemo(() => {
    if (!effectiveStartDate || !effectiveEndDate) return [];
    return buildItineraryDays(effectiveStartDate, effectiveEndDate, blocks, rsvps);
  }, [effectiveStartDate, effectiveEndDate, blocks, rsvps]);

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
    const dateRange = effectiveStartDate && effectiveEndDate
      ? (() => {
          const [sy, sm, sd] = effectiveStartDate.split('-').map(Number);
          const [ey, em, ed] = effectiveEndDate.split('-').map(Number);
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
      { text: 'Export to Google Calendar', onPress: handleExportToGoogleCalendar },
      { text: 'More options…', onPress: async () => { try { await Share.share({ message: msg }); } catch {} } },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  /**
   * Export every itinerary block to the planner's Google Calendar and
   * auto-invite trip members for whom we have an email. The Google
   * access token lives on session.provider_token after a Google OAuth
   * sign-in; if it's missing or expired (e.g. signed in via email/
   * password, or the ~1h token elapsed) we trigger the OAuth flow so
   * Supabase grants Calendar access, then continue.
   */
  async function handleExportToGoogleCalendar() {
    if (!trip) return;

    const exportableBlocks = blocks.filter((b) => Boolean(b.day_date));
    if (exportableBlocks.length === 0) {
      Alert.alert('Nothing to export', 'Add itinerary blocks first.');
      return;
    }

    const attendeeEmails = Array.from(
      new Set(
        respondents
          .map((r) => r.email?.trim().toLowerCase())
          .filter((e): e is string => Boolean(e && /.+@.+\..+/.test(e))),
      ),
    );
    const noEmailCount = respondents.filter((r) => !r.email).length;

    const summaryParts = [
      `Create ${exportableBlocks.length} ${exportableBlocks.length === 1 ? 'event' : 'events'} on your Google Calendar.`,
      attendeeEmails.length > 0
        ? `${attendeeEmails.length} ${attendeeEmails.length === 1 ? 'invite' : 'invites'} will go out via Google.`
        : 'No member emails on file — no invites will be sent.',
    ];
    if (noEmailCount > 0) {
      summaryParts.push(`${noEmailCount} ${noEmailCount === 1 ? 'member has' : 'members have'} no email; they won't be invited.`);
    }

    Alert.alert('Export to Google Calendar', summaryParts.join('\n\n'), [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Export',
        onPress: () => runExport(exportableBlocks, attendeeEmails),
      },
    ]);
  }

  async function runExport(
    exportableBlocks: ItineraryBlock[],
    attendeeEmails: string[],
  ) {
    if (!trip) return;

    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const tripShareUrl = trip.share_token ? getShareUrl(trip.share_token) : null;

    async function attempt(token: string) {
      return exportItineraryToGoogleCalendar({
        accessToken: token,
        blocks: exportableBlocks,
        attendeeEmails,
        timeZone: tz,
        tripName: trip?.name ?? null,
        tripShareUrl,
      });
    }

    try {
      // First try with the live session's provider_token. Missing when
      // the user signed in via email/password, or when the token has
      // dropped off the session after an app restart.
      const { data: { session } } = await supabase.auth.getSession();
      let token = session?.provider_token ?? null;

      let result = token ? await attempt(token) : null;

      if (!result || result.authExpired || (result.failed.length > 0 && result.created === 0)) {
        // Re-auth with Google to get a fresh Calendar-scoped token,
        // then retry once.
        const reauth = await googleSignIn({ withCalendarScope: true });
        if (!reauth) return; // user cancelled the OAuth pop-up
        const { data: { session: refreshed } } = await supabase.auth.getSession();
        token = refreshed?.provider_token ?? null;
        if (!token) {
          Alert.alert(
            'Could not connect to Google',
            "Google didn't return a Calendar access token. Sign out and sign back in with Google, then try again.",
          );
          return;
        }
        result = await attempt(token);
      }

      if (result.created === 0 && result.failed.length > 0) {
        Alert.alert(
          'Export failed',
          result.failed[0]?.reason ?? 'Try again.',
        );
        return;
      }

      const lines = [
        `${result.created} ${result.created === 1 ? 'event' : 'events'} added to your Google Calendar.`,
      ];
      if (result.invited.length > 0) {
        lines.push(`Google sent invites to ${result.invited.length} ${result.invited.length === 1 ? 'member' : 'members'}.`);
      }
      if (result.failed.length > 0) {
        lines.push(`${result.failed.length} ${result.failed.length === 1 ? 'block' : 'blocks'} couldn't be exported (${result.failed[0].reason}).`);
      }
      Alert.alert('Exported to Google Calendar', lines.join('\n\n'));
    } catch (err) {
      Alert.alert(
        'Export failed',
        err instanceof Error ? err.message : 'Try again.',
      );
    }
  }

  const hasDates = Boolean(effectiveStartDate && effectiveEndDate);
  // When dates aren't decided yet, point the planner to the source of
  // truth (the dates poll) instead of asking them to type in dates here
  // — that input would just get clobbered the moment the poll locks.
  const liveDatesPoll = polls.find((p) => p.type === 'dates' && p.status === 'live');

  return (
    <View className="flex-1 bg-cream">
      {/* Header */}
      <View className="flex-row items-center justify-between px-6 pt-4 pb-3">
        <Text className="text-base font-bold text-ink">Itinerary</Text>
        <Pressable onPress={handleShare} className="p-1 active:opacity-60">
          <Ionicons name="share-outline" size={20} color="#5F685F" />
        </Pressable>
      </View>

      {!hasDates ? (
        /* Empty state — no dates */
        <View className="flex-1 justify-center">
          <EmptyState
            icon="calendar-outline"
            title={liveDatesPoll ? 'Dates still being decided' : 'No trip dates yet'}
            body={
              liveDatesPoll
                ? 'The itinerary fills in automatically once the group locks the dates poll.'
                : 'Trip dates flow in from the dates poll. You can also set them directly.'
            }
          />
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
            hasDates={hasDates}
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
            <Ionicons name="pencil-outline" size={12} color="#9DA8A0" />
            <Text className="text-xs text-muted">Edit trip dates</Text>
          </Pressable>

          {/* Empty state */}
          {blocks.length === 0 ? (
            <EmptyState
              icon="calendar-outline"
              title="No activities yet"
              body="Tap any day above to start building your itinerary, or use AI to generate options."
            />
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
        startDate={effectiveStartDate}
        endDate={effectiveEndDate}
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
