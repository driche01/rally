/**
 * AI Itinerary Options Screen — Phase 4.2
 *
 * Shows 3 AI-generated itinerary options (Packed / Balanced / Relaxed).
 * The planner can preview each option's day-by-day schedule and apply one
 * to their itinerary_blocks. A freetext override lets the planner nudge
 * the next generation ("make it more budget-conscious", etc.).
 *
 * Navigation: pushed from ItineraryTab via router.push('/(app)/trips/[id]/ai-itinerary')
 */

import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTrip } from '@/hooks/useTrips';
import {
  useAiItineraryDraft,
  useGenerateAiItinerary,
  useApplyAiItineraryOption,
} from '@/hooks/useAiItinerary';
import { formatDayLabel, formatTime } from '@/lib/api/itinerary';
import type { AiItineraryOption, AiItineraryDay, BlockType } from '@/types/database';

// ─── Constants ────────────────────────────────────────────────────────────────

const OPTION_STYLES: Record<string, { accent: string; badge: string; icon: React.ComponentProps<typeof Ionicons>['name'] }> = {
  Packed:   { accent: '#1A4060', badge: '#D8E4EE', icon: 'flash' },
  Balanced: { accent: '#235C38', badge: '#DDE8D8', icon: 'leaf' },
  Relaxed:  { accent: '#7A4C1E', badge: '#F2E5D8', icon: 'sunny' },
};

const BLOCK_TYPE_ICONS: Record<string, React.ComponentProps<typeof Ionicons>['name']> = {
  activity:      'bicycle-outline',
  meal:          'restaurant-outline',
  travel:        'car-outline',
  accommodation: 'bed-outline',
  free_time:     'sunny-outline',
};

const BLOCK_TYPE_COLORS: Record<string, string> = {
  activity:      '#2563EB',
  meal:          '#EA580C',
  travel:        '#9333EA',
  accommodation: '#0F3F2E',
  free_time:     '#16A34A',
};

const LOADING_MESSAGES = [
  'Analyzing your group\'s preferences…',
  'Planning activities and experiences…',
  'Crafting three distinct options…',
  'Adding finishing touches…',
];

// ─── Sub-components ───────────────────────────────────────────────────────────

function BlockRow({ block }: { block: AiItineraryOption['days'][0]['blocks'][0] }) {
  const icon = BLOCK_TYPE_ICONS[block.type] ?? 'ellipse-outline';
  const color = BLOCK_TYPE_COLORS[block.type] ?? '#737373';
  const timeRange = block.start_time
    ? block.end_time
      ? `${formatTime(block.start_time)} – ${formatTime(block.end_time)}`
      : formatTime(block.start_time)
    : null;

  return (
    <View style={styles.blockRow}>
      <Ionicons name={icon} size={14} color={color} style={{ marginTop: 1 }} />
      <View style={{ flex: 1 }}>
        <Text style={styles.blockTitle}>{block.title}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 1 }}>
          {timeRange ? (
            <Text style={styles.blockMeta}>{timeRange}</Text>
          ) : null}
          {block.location ? (
            <Text style={styles.blockMeta} numberOfLines={1}>
              {block.location}
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}

function DayPreview({ day }: { day: AiItineraryDay }) {
  return (
    <View style={styles.dayPreview}>
      <Text style={styles.dayLabel}>{formatDayLabel(day.date)}</Text>
      {day.blocks.map((block, i) => (
        <BlockRow key={i} block={block} />
      ))}
    </View>
  );
}

function OptionCard({
  option,
  isSelected,
  onSelect,
}: {
  option: AiItineraryOption;
  isSelected: boolean;
  onSelect: () => void;
}) {
  // First option auto-expanded so there's immediate visual richness
  const [expanded, setExpanded] = useState(option.index === 0);
  const style = OPTION_STYLES[option.label] ?? OPTION_STYLES.Balanced;

  return (
    <Pressable
      onPress={onSelect}
      style={[
        styles.card,
        isSelected && { borderColor: style.accent, borderWidth: 2 },
      ]}
    >
      {/* Header */}
      <View style={[styles.cardHeader, { backgroundColor: style.badge }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Ionicons name={style.icon} size={18} color={style.accent} />
          <Text style={[styles.cardLabel, { color: style.accent }]}>{option.label}</Text>
        </View>
        {isSelected ? (
          <View style={[styles.selectedBadge, { backgroundColor: style.accent }]}>
            <Text style={styles.selectedBadgeText}>Selected</Text>
          </View>
        ) : null}
      </View>

      {/* Theme + summary */}
      <View style={styles.cardBody}>
        <Text style={styles.cardTheme}>{option.theme}</Text>
        <Text style={styles.cardSummary}>{option.summary}</Text>

        {/* Day preview toggle */}
        <Pressable
          onPress={() => setExpanded((v) => !v)}
          style={styles.previewToggle}
          accessibilityRole="button"
          accessibilityLabel={expanded ? 'Collapse schedule' : 'Preview day-by-day schedule'}
        >
          <Text style={[styles.previewToggleText, { color: style.accent }]}>
            {expanded ? 'Hide schedule' : 'Preview schedule'}
          </Text>
          <Ionicons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={14}
            color={style.accent}
          />
        </Pressable>

        {expanded ? (
          <View style={{ marginTop: 12, gap: 0 }}>
            {option.days.map((day) => (
              <DayPreview key={day.date} day={day} />
            ))}
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

// ─── Regenerate modal ─────────────────────────────────────────────────────────

function RegenerateModal({
  visible,
  onClose,
  onGenerate,
  generating,
}: {
  visible: boolean;
  onClose: () => void;
  onGenerate: (override: string) => void;
  generating: boolean;
}) {
  const [override, setOverride] = useState('');

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
        <Pressable
          onPress={() => {}}
          style={styles.modalSheet}
        >
          <View style={styles.dragHandle} />
          <Text style={styles.modalTitle}>Regenerate options</Text>
          <Text style={styles.modalSubtitle}>
            Optionally add a note to guide the next generation.
          </Text>
          <TextInput
            value={override}
            onChangeText={setOverride}
            placeholder='e.g. "More budget-conscious" or "Include a winery visit"'
            placeholderTextColor="#A3A3A3"
            multiline
            numberOfLines={3}
            style={styles.overrideInput}
            maxLength={300}
          />
          <Pressable
            onPress={() => onGenerate(override.trim())}
            disabled={generating}
            style={[styles.generateBtn, generating && { opacity: 0.6 }]}
          >
            {generating ? (
              <ActivityIndicator size="small" color="white" />
            ) : (
              <Text style={styles.generateBtnText}>Regenerate</Text>
            )}
          </Pressable>
          <Pressable onPress={onClose} style={{ marginTop: 12, alignItems: 'center' }}>
            <Text style={{ color: '#737373', fontSize: 14 }}>Cancel</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function AiItineraryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const { data: trip } = useTrip(id);
  const { data: draft, isLoading } = useAiItineraryDraft(id);
  const generate = useGenerateAiItinerary(id);
  const apply = useApplyAiItineraryOption(id);

  const [selectedIndex, setSelectedIndex] = useState<number | null>(
    draft?.selected_index ?? null
  );
  const [regenModalVisible, setRegenModalVisible] = useState(false);
  const [confirmingApply, setConfirmingApply] = useState(false);
  const [loadingMsgIdx, setLoadingMsgIdx] = useState(0);

  const isGenerating = draft?.status === 'generating' || generate.isPending;
  const hasOptions = draft?.status === 'ready' && (draft.options?.length ?? 0) > 0;
  const hasError = draft?.status === 'error';

  // Cycle through loading messages while generating
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

  // Reset confirmation state if selection changes
  useEffect(() => {
    setConfirmingApply(false);
  }, [selectedIndex]);

  const selectedStyle =
    selectedIndex !== null && draft?.options?.[selectedIndex]
      ? OPTION_STYLES[draft.options[selectedIndex].label] ?? OPTION_STYLES.Balanced
      : null;

  function handleApplyPress() {
    if (selectedIndex === null || !draft || !hasOptions) return;
    setConfirmingApply(true);
  }

  function handleConfirmApply() {
    if (selectedIndex === null || !draft || !hasOptions) return;
    const option = draft.options[selectedIndex];
    if (!option) return;
    apply.mutate(
      { draftId: draft.id, option },
      {
        onSuccess: () => {
          setConfirmingApply(false);
          router.back();
        },
        onError: (err: any) => {
          setConfirmingApply(false);
          const msg = err?.message ?? 'Could not apply the itinerary. Please try again.';
          Alert.alert('Error', msg);
        },
      }
    );
  }

  function handleGenerate(override: string) {
    setRegenModalVisible(false);
    setSelectedIndex(null);
    generate.mutate({ override: override || undefined });
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" hitSlop={8}>
          <Ionicons name="arrow-back" size={22} color="#163026" />
        </Pressable>
        <View style={{ flex: 1, marginHorizontal: 16 }}>
          <Text style={styles.headerTitle}>AI Itinerary Options</Text>
          {trip?.destination ? (
            <Text style={styles.headerSub} numberOfLines={1}>{trip.destination}</Text>
          ) : null}
        </View>
        {hasOptions ? (
          <Pressable
            onPress={() => setRegenModalVisible(true)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Regenerate options"
          >
            <Ionicons name="refresh-outline" size={20} color="#737373" />
          </Pressable>
        ) : null}
      </View>

      {/* Body */}
      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#0F3F2E" />
        </View>
      ) : isGenerating ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#0F3F2E" />
          <Text style={styles.generatingText}>{LOADING_MESSAGES[loadingMsgIdx]}</Text>
          <Text style={styles.generatingSubText}>This takes about 15–20 seconds</Text>
        </View>
      ) : hasError ? (
        <View style={styles.centered}>
          <Ionicons name="warning-outline" size={40} color="#EF4444" />
          <Text style={styles.errorText}>Generation failed</Text>
          <Text style={styles.errorSubText}>{draft?.error_message ?? 'Something went wrong'}</Text>
          <Pressable
            onPress={() => handleGenerate('')}
            style={[styles.generateBtn, { marginTop: 20 }]}
          >
            <Text style={styles.generateBtnText}>Try again</Text>
          </Pressable>
        </View>
      ) : !hasOptions ? (
        /* Should not normally appear — ItineraryTab triggers generation first */
        <View style={styles.centered}>
          <Ionicons name="sparkles-outline" size={40} color="#D4D4D4" />
          <Text style={styles.emptyText}>No options yet</Text>
          <Pressable onPress={() => handleGenerate('')} style={[styles.generateBtn, { marginTop: 20 }]}>
            <Text style={styles.generateBtnText}>Generate options</Text>
          </Pressable>
        </View>
      ) : (
        <>
          <ScrollView
            contentContainerStyle={{
              paddingHorizontal: 20,
              paddingTop: 16,
              paddingBottom: insets.bottom + 100,
              gap: 16,
            }}
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.introText}>
              Pick the option that fits your group best — you can edit individual blocks after applying.
            </Text>
            {draft.options.map((option) => (
              <OptionCard
                key={option.index}
                option={option}
                isSelected={selectedIndex === option.index}
                onSelect={() => setSelectedIndex(option.index)}
              />
            ))}
          </ScrollView>

          {/* Apply bar — normal or confirming state */}
          <View style={[styles.applyBar, { paddingBottom: insets.bottom + 12 }]}>
            {confirmingApply ? (
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Pressable
                  onPress={() => setConfirmingApply(false)}
                  style={[styles.applyBtn, styles.applyBtnBack]}
                >
                  <Ionicons name="arrow-back" size={16} color="#525252" />
                  <Text style={[styles.applyBtnText, { color: '#525252' }]}>Back</Text>
                </Pressable>
                <Pressable
                  onPress={handleConfirmApply}
                  disabled={apply.isPending}
                  style={[
                    styles.applyBtn,
                    { flex: 2, backgroundColor: selectedStyle?.accent ?? '#1A4060' },
                    apply.isPending && { opacity: 0.6 },
                  ]}
                >
                  {apply.isPending ? (
                    <ActivityIndicator size="small" color="white" />
                  ) : (
                    <Text style={styles.applyBtnText}>
                      ✓ Apply {draft.options[selectedIndex!]?.label}
                    </Text>
                  )}
                </Pressable>
              </View>
            ) : (
              <Pressable
                onPress={handleApplyPress}
                disabled={selectedIndex === null}
                style={[
                  styles.applyBtn,
                  selectedIndex !== null
                    ? { backgroundColor: selectedStyle?.accent ?? '#1A4060' }
                    : styles.applyBtnDisabled,
                ]}
              >
                <Text style={styles.applyBtnText}>
                  {selectedIndex !== null
                    ? `Apply "${draft.options[selectedIndex]?.label}" itinerary`
                    : 'Select an option to apply'}
                </Text>
              </Pressable>
            )}
          </View>
        </>
      )}

      <RegenerateModal
        visible={regenModalVisible}
        onClose={() => setRegenModalVisible(false)}
        onGenerate={handleGenerate}
        generating={isGenerating}
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9F9F7',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5E5',
    backgroundColor: '#FFFFFF',
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#163026',
  },
  headerSub: {
    fontSize: 12,
    color: '#737373',
    marginTop: 1,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 8,
  },
  generatingText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#163026',
    marginTop: 16,
    textAlign: 'center',
  },
  generatingSubText: {
    fontSize: 13,
    color: '#737373',
    textAlign: 'center',
  },
  errorText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#EF4444',
    marginTop: 12,
  },
  errorSubText: {
    fontSize: 13,
    color: '#737373',
    textAlign: 'center',
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#737373',
    marginTop: 12,
  },
  introText: {
    fontSize: 13,
    color: '#737373',
    textAlign: 'center',
    marginBottom: 4,
  },
  // ── Option card ────────────────────────────────────────────────────────────
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: '#E5E5E5',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  cardLabel: {
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  selectedBadge: {
    borderRadius: 99,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  selectedBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  cardBody: {
    padding: 16,
  },
  cardTheme: {
    fontSize: 14,
    fontWeight: '600',
    color: '#163026',
    marginBottom: 6,
  },
  cardSummary: {
    fontSize: 13,
    color: '#525252',
    lineHeight: 19,
  },
  previewToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 12,
    alignSelf: 'flex-start',
  },
  previewToggleText: {
    fontSize: 13,
    fontWeight: '600',
  },
  // ── Day preview ────────────────────────────────────────────────────────────
  dayPreview: {
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#F0F0F0',
    marginTop: 8,
    gap: 6,
  },
  dayLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#737373',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  blockRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingVertical: 2,
  },
  blockTitle: {
    fontSize: 13,
    fontWeight: '500',
    color: '#163026',
  },
  blockMeta: {
    fontSize: 11,
    color: '#A3A3A3',
  },
  // ── Apply bar ──────────────────────────────────────────────────────────────
  applyBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    paddingTop: 12,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E5E5E5',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 8,
  },
  applyBtn: {
    flex: 1,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  applyBtnBack: {
    flex: 1,
    backgroundColor: '#F5F5F3',
  },
  applyBtnDisabled: {
    backgroundColor: '#D4D4D4',
  },
  applyBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  // ── Regenerate modal ───────────────────────────────────────────────────────
  modalSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    gap: 12,
  },
  dragHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E5E5E5',
    alignSelf: 'center',
    marginBottom: 8,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#163026',
  },
  modalSubtitle: {
    fontSize: 13,
    color: '#737373',
  },
  overrideInput: {
    borderWidth: 1.5,
    borderColor: '#E5E5E5',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: '#163026',
    minHeight: 80,
    textAlignVertical: 'top',
  },
  generateBtn: {
    backgroundColor: '#1A4060',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  generateBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
