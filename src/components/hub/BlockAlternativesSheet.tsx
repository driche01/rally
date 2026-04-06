/**
 * BlockAlternativesSheet — Phase 4.3
 *
 * Bottom sheet triggered by long-pressing an itinerary block.
 * Calls Gemini to suggest 2 alternative versions of the block based on
 * trip context and group preferences. The planner can:
 *   • Select one of the 2 AI alternatives to replace the block
 *   • Type a custom prompt to get a 3rd tailored option
 *   • Dismiss without making changes
 */

import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSuggestBlockAlternatives } from '@/hooks/useBlockAlternatives';
import { formatTime } from '@/lib/api/itinerary';
import type { AiBlockAlternative, ItineraryBlock, BlockType } from '@/types/database';

// ─── Constants ────────────────────────────────────────────────────────────────

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
  accommodation: '#D85A30',
  free_time:     '#16A34A',
};

const BLOCK_TYPE_BG: Record<string, string> = {
  activity:      '#EFF6FF',
  meal:          '#FFF7ED',
  travel:        '#FAF5FF',
  accommodation: '#FFF1F0',
  free_time:     '#F0FDF4',
};

function blockTimeRange(block: Pick<ItineraryBlock | AiBlockAlternative, 'start_time' | 'end_time'>): string | null {
  if (!block.start_time) return null;
  return block.end_time
    ? `${formatTime(block.start_time)} – ${formatTime(block.end_time)}`
    : formatTime(block.start_time);
}

// ─── Alternative card ─────────────────────────────────────────────────────────

function AlternativeCard({
  alt,
  accent,
  onUse,
  applying,
}: {
  alt: AiBlockAlternative;
  accent: string;
  onUse: () => void;
  applying: boolean;
}) {
  const icon = BLOCK_TYPE_ICONS[alt.type] ?? 'ellipse-outline';
  const color = BLOCK_TYPE_COLORS[alt.type] ?? '#737373';
  const bg = BLOCK_TYPE_BG[alt.type] ?? '#F5F5F3';
  const timeRange = blockTimeRange(alt);

  return (
    <View style={styles.altCard}>
      {/* Type + title row */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
        <View style={[styles.altIconWrap, { backgroundColor: bg }]}>
          <Ionicons name={icon} size={16} color={color} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.altTitle}>{alt.title}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {timeRange ? (
              <Text style={styles.altMeta}>{timeRange}</Text>
            ) : null}
            {alt.location ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                <Ionicons name="location-outline" size={10} color="#A3A3A3" />
                <Text style={styles.altMeta} numberOfLines={1}>{alt.location}</Text>
              </View>
            ) : null}
          </View>
        </View>
      </View>

      {/* Reason */}
      <Text style={styles.altReason}>"{alt.reason}"</Text>

      {/* Use button */}
      <Pressable
        onPress={onUse}
        disabled={applying}
        style={[styles.useBtn, { backgroundColor: accent }, applying && { opacity: 0.6 }]}
      >
        {applying ? (
          <ActivityIndicator size="small" color="white" />
        ) : (
          <>
            <Text style={styles.useBtnText}>Use this</Text>
            <Ionicons name="arrow-forward" size={14} color="white" />
          </>
        )}
      </Pressable>
    </View>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  visible: boolean;
  block: ItineraryBlock | null;
  tripId: string;
  onClose: () => void;
  onApply: (alt: AiBlockAlternative) => void;
  applying: boolean;
}

export function BlockAlternativesSheet({ visible, block, tripId, onClose, onApply, applying }: Props) {
  const insets = useSafeAreaInsets();
  const suggest = useSuggestBlockAlternatives();

  // PanResponder on the drag handle — swipe down ≥ 60px to dismiss
  const dragPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gs) => gs.dy > 5,
      onPanResponderRelease: (_, gs) => {
        if (gs.dy > 60) onClose();
      },
    })
  ).current;
  const [alternatives, setAlternatives] = useState<AiBlockAlternative[]>([]);
  const [customAlt, setCustomAlt] = useState<AiBlockAlternative | null>(null);
  const [userPrompt, setUserPrompt] = useState('');
  const [isLoadingCustom, setIsLoadingCustom] = useState(false);
  const [customError, setCustomError] = useState<string | null>(null);

  // Fetch 2 standard alternatives whenever the sheet opens with a new block
  useEffect(() => {
    if (!visible || !block) return;
    setAlternatives([]);
    setCustomAlt(null);
    setUserPrompt('');
    setCustomError(null);

    suggest.mutate(
      {
        tripId,
        block: {
          type: block.type,
          title: block.title,
          start_time: block.start_time,
          end_time: block.end_time,
          location: block.location,
          notes: block.notes,
          day_date: block.day_date,
        },
      },
      {
        onSuccess: (alts) => setAlternatives(alts),
      }
    );
  }, [visible, block?.id]);

  async function handleGetCustom() {
    if (!block || !userPrompt.trim()) return;
    setIsLoadingCustom(true);
    setCustomError(null);
    setCustomAlt(null);

    suggest.mutate(
      {
        tripId,
        block: {
          type: block.type,
          title: block.title,
          start_time: block.start_time,
          end_time: block.end_time,
          location: block.location,
          notes: block.notes,
          day_date: block.day_date,
        },
        existingAlternatives: alternatives,
        userPrompt: userPrompt.trim(),
      },
      {
        onSuccess: (alts) => {
          setCustomAlt(alts[0] ?? null);
          setIsLoadingCustom(false);
        },
        onError: () => {
          setCustomError('Could not get custom option. Try again.');
          setIsLoadingCustom(false);
        },
      }
    );
  }

  if (!block) return null;

  const isLoadingInitial = suggest.isPending && alternatives.length === 0 && !customAlt;
  const timeRange = blockTimeRange(block);
  const blockIcon = BLOCK_TYPE_ICONS[block.type] ?? 'ellipse-outline';
  const blockColor = BLOCK_TYPE_COLORS[block.type] ?? '#737373';
  const blockBg = BLOCK_TYPE_BG[block.type] ?? '#F5F5F3';

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      {/* Backdrop sits behind the sheet — taps here close; taps on sheet don't */}
      <View style={styles.backdropContainer}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />

        <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
          {/* Drag handle — swipe down to dismiss */}
          <View style={styles.dragHandleHitArea} {...dragPan.panHandlers}>
            <View style={styles.dragHandle} />
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ gap: 20, paddingBottom: 8 }}
            bounces={true}
          >
            {/* Header */}
            <View style={{ gap: 4 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Ionicons name="sparkles" size={16} color="#1A4060" />
                <Text style={styles.sheetTitle}>AI Alternatives</Text>
              </View>
              <Text style={styles.sheetSubtitle}>Replacing:</Text>

              {/* Current block preview */}
              <View style={styles.currentBlock}>
                <View style={[styles.altIconWrap, { backgroundColor: blockBg }]}>
                  <Ionicons name={blockIcon} size={14} color={blockColor} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.currentBlockTitle} numberOfLines={1}>{block.title}</Text>
                  {timeRange ? (
                    <Text style={styles.altMeta}>{timeRange}</Text>
                  ) : null}
                </View>
              </View>
            </View>

            {/* Divider */}
            <View style={styles.divider} />

            {/* Loading state */}
            {isLoadingInitial ? (
              <View style={styles.loadingWrap}>
                <ActivityIndicator size="small" color="#1A4060" />
                <Text style={styles.loadingText}>Finding alternatives…</Text>
              </View>
            ) : alternatives.length === 0 && suggest.isError ? (
              <View style={styles.loadingWrap}>
                <Ionicons name="warning-outline" size={22} color="#EF4444" />
                <Text style={[styles.loadingText, { color: '#EF4444' }]}>
                  Could not load alternatives. Check your connection and try again.
                </Text>
              </View>
            ) : (
              <>
                {alternatives.map((alt, i) => (
                  <AlternativeCard
                    key={i}
                    alt={alt}
                    accent="#1A4060"
                    onUse={() => onApply(alt)}
                    applying={applying}
                  />
                ))}

                {/* Custom prompt section */}
                {alternatives.length > 0 ? (
                  <View style={styles.customSection}>
                    <Text style={styles.customLabel}>Something else in mind?</Text>
                    <TextInput
                      value={userPrompt}
                      onChangeText={setUserPrompt}
                      placeholder='e.g. "Something more low-key" or "Include a local winery"'
                      placeholderTextColor="#A3A3A3"
                      multiline
                      numberOfLines={2}
                      style={styles.customInput}
                      maxLength={200}
                    />
                    <Pressable
                      onPress={handleGetCustom}
                      disabled={!userPrompt.trim() || isLoadingCustom}
                      style={[
                        styles.customBtn,
                        (!userPrompt.trim() || isLoadingCustom) && styles.customBtnDisabled,
                      ]}
                    >
                      {isLoadingCustom ? (
                        <ActivityIndicator size="small" color="white" />
                      ) : (
                        <>
                          <Ionicons name="sparkles-outline" size={14} color="white" />
                          <Text style={styles.customBtnText}>Get custom option</Text>
                        </>
                      )}
                    </Pressable>

                    {customError ? (
                      <Text style={styles.customError}>{customError}</Text>
                    ) : null}

                    {/* Custom alternative result */}
                    {customAlt ? (
                      <View style={{ marginTop: 4 }}>
                        <AlternativeCard
                          alt={customAlt}
                          accent="#D85A30"
                          onUse={() => onApply(customAlt)}
                          applying={applying}
                        />
                      </View>
                    ) : null}
                  </View>
                ) : null}
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  backdropContainer: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 24,
    maxHeight: '88%',
  },
  dragHandleHitArea: {
    paddingTop: 12,
    paddingBottom: 8,
    alignItems: 'center',
  },
  dragHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E5E5E5',
  },
  sheetTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#1A1A1A',
  },
  sheetSubtitle: {
    fontSize: 12,
    color: '#A3A3A3',
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  currentBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#F9F9F7',
    borderRadius: 12,
    padding: 10,
    marginTop: 6,
  },
  currentBlockTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1A1A1A',
  },
  divider: {
    height: 1,
    backgroundColor: '#F0F0F0',
    marginHorizontal: -24,
  },
  loadingWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 20,
  },
  loadingText: {
    fontSize: 14,
    color: '#737373',
    flex: 1,
  },
  // ── Alternative card ───────────────────────────────────────────────────────
  altCard: {
    backgroundColor: '#FAFAF8',
    borderRadius: 16,
    padding: 14,
    gap: 10,
    borderWidth: 1,
    borderColor: '#EBEBEB',
  },
  altIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  altTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1A1A1A',
    lineHeight: 19,
  },
  altMeta: {
    fontSize: 12,
    color: '#A3A3A3',
  },
  altReason: {
    fontSize: 13,
    color: '#737373',
    fontStyle: 'italic',
    lineHeight: 18,
  },
  useBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 12,
    paddingVertical: 11,
    alignSelf: 'stretch',
  },
  useBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  // ── Custom prompt ──────────────────────────────────────────────────────────
  customSection: {
    gap: 10,
    paddingTop: 4,
  },
  customLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#525252',
  },
  customInput: {
    borderWidth: 1.5,
    borderColor: '#E5E5E5',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: '#1A1A1A',
    minHeight: 64,
    textAlignVertical: 'top',
  },
  customBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#D85A30',
    borderRadius: 12,
    paddingVertical: 12,
  },
  customBtnDisabled: {
    opacity: 0.4,
  },
  customBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  customError: {
    fontSize: 13,
    color: '#EF4444',
    textAlign: 'center',
  },
});
