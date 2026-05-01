import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

export type CardKey = 'activity' | 'itinerary' | 'lodging' | 'travel' | 'expenses';

export const ALL_CARD_KEYS: CardKey[] = [
  'activity',
  'itinerary',
  'lodging',
  'travel',
  'expenses',
];

const CARD_H = 72; // padding 16 + icon 40 + padding 16
const GAP = 10;
const STEP = CARD_H + GAP; // 82
const SPRING_CFG = { damping: 20 };

function storageKey(tripId: string) {
  return `card-order-${tripId}`;
}

// ─── Module-level worklet helpers ────────────────────────────────────────────
// Using explicit SharedValue params (not arrays) avoids Reanimated Babel-plugin
// serialisation issues with dynamically-indexed arrays inside worklets.

/**
 * Finds the card currently occupying `hoverSlot` (other than the card at
 * `excludeIdx`) and moves it to `currentSlot`, animating its top value.
 */
function doSwap(
  excludeIdx: number,
  hoverSlot: number,
  currentSlot: number,
  s0: SharedValue<number>, t0: SharedValue<number>,
  s1: SharedValue<number>, t1: SharedValue<number>,
  s2: SharedValue<number>, t2: SharedValue<number>,
  s3: SharedValue<number>, t3: SharedValue<number>,
  s4: SharedValue<number>, t4: SharedValue<number>,
  s5: SharedValue<number>, t5: SharedValue<number>,
): void {
  'worklet';
  const dest = currentSlot * STEP;
  if (excludeIdx !== 0 && s0.value === hoverSlot) { s0.value = currentSlot; t0.value = withSpring(dest, SPRING_CFG); return; }
  if (excludeIdx !== 1 && s1.value === hoverSlot) { s1.value = currentSlot; t1.value = withSpring(dest, SPRING_CFG); return; }
  if (excludeIdx !== 2 && s2.value === hoverSlot) { s2.value = currentSlot; t2.value = withSpring(dest, SPRING_CFG); return; }
  if (excludeIdx !== 3 && s3.value === hoverSlot) { s3.value = currentSlot; t3.value = withSpring(dest, SPRING_CFG); return; }
  if (excludeIdx !== 4 && s4.value === hoverSlot) { s4.value = currentSlot; t4.value = withSpring(dest, SPRING_CFG); return; }
  if (excludeIdx !== 5 && s5.value === hoverSlot) { s5.value = currentSlot; t5.value = withSpring(dest, SPRING_CFG); return; }
}

/**
 * Builds a slotToKeyIdx array: index = visual slot, value = card keyIndex.
 * (The inverse of the slot SharedValues.)
 */
function buildResult(
  s0: SharedValue<number>, s1: SharedValue<number>, s2: SharedValue<number>,
  s3: SharedValue<number>, s4: SharedValue<number>, s5: SharedValue<number>,
): number[] {
  'worklet';
  const r = [0, 0, 0, 0, 0, 0];
  r[s0.value] = 0; r[s1.value] = 1; r[s2.value] = 2;
  r[s3.value] = 3; r[s4.value] = 4; r[s5.value] = 5;
  return r;
}

// ─── AnimatedCard ──────────────────────────────────────────────────────────────

interface AnimatedCardProps {
  topSV: SharedValue<number>;
  scaleSV: SharedValue<number>;
  editMode: boolean;
  dragGesture: ReturnType<typeof Gesture.Pan>;
  onEnterEditMode: () => void;
  children: React.ReactNode;
}

function AnimatedCard({
  topSV,
  scaleSV,
  editMode,
  dragGesture,
  onEnterEditMode,
  children,
}: AnimatedCardProps) {
  const animStyle = useAnimatedStyle(() => ({
    position: 'absolute',
    left: 0,
    right: 0,
    top: topSV.value,
    transform: [{ scale: scaleSV.value }],
    zIndex: scaleSV.value > 1.01 ? 10 : 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: scaleSV.value > 1.01 ? 0.12 : 0,
    shadowRadius: 10,
    elevation: scaleSV.value > 1.01 ? 6 : 0,
  }));

  const longPressGesture = useMemo(
    () =>
      Gesture.LongPress()
        .minDuration(400)
        .onEnd((_e, success) => {
          'worklet';
          if (success) runOnJS(onEnterEditMode)();
        }),
    [onEnterEditMode],
  );

  if (editMode) {
    return (
      <GestureDetector gesture={dragGesture}>
        <Animated.View style={animStyle}>{children}</Animated.View>
      </GestureDetector>
    );
  }

  return (
    <GestureDetector gesture={longPressGesture}>
      <Animated.View style={animStyle}>{children}</Animated.View>
    </GestureDetector>
  );
}

// ─── SortableEntryList ────────────────────────────────────────────────────────

interface SortableEntryListProps {
  tripId: string;
  renderCard: (key: CardKey, editMode: boolean) => React.ReactNode;
  /** When false, long-press reorder mode is disabled (non-planners). Default: true. */
  reorderEnabled?: boolean;
}

export function SortableEntryList({ tripId, renderCard, reorderEnabled = true }: SortableEntryListProps) {
  const [editMode, setEditMode] = useState(false);

  // ── Per-card SharedValues (explicit — hooks cannot be called in loops) ────
  // top: absolute pixel position from container top
  const top0 = useSharedValue(0 * STEP);
  const top1 = useSharedValue(1 * STEP);
  const top2 = useSharedValue(2 * STEP);
  const top3 = useSharedValue(3 * STEP);
  const top4 = useSharedValue(4 * STEP);
  const top5 = useSharedValue(5 * STEP);

  // scale: 1.0 at rest, ~1.03 while dragging
  const scale0 = useSharedValue(1.0);
  const scale1 = useSharedValue(1.0);
  const scale2 = useSharedValue(1.0);
  const scale3 = useSharedValue(1.0);
  const scale4 = useSharedValue(1.0);
  const scale5 = useSharedValue(1.0);

  // slot: current visual slot index (0–5) of each card
  const slot0 = useSharedValue(0);
  const slot1 = useSharedValue(1);
  const slot2 = useSharedValue(2);
  const slot3 = useSharedValue(3);
  const slot4 = useSharedValue(4);
  const slot5 = useSharedValue(5);

  // startY: captured at drag begin — must be a SharedValue so it persists
  // between the onBegin and onUpdate worklet invocations
  const startY0 = useSharedValue(0);
  const startY1 = useSharedValue(0);
  const startY2 = useSharedValue(0);
  const startY3 = useSharedValue(0);
  const startY4 = useSharedValue(0);
  const startY5 = useSharedValue(0);

  // ── Load saved order from AsyncStorage ───────────────────────────────────
  useEffect(() => {
    AsyncStorage.getItem(storageKey(tripId))
      .then((val) => {
        if (!val) return;
        const saved = JSON.parse(val) as CardKey[];
        if (saved.length !== 6 || !ALL_CARD_KEYS.every((k) => saved.includes(k))) return;
        // Apply saved order: map visualSlot → cardIdx → SharedValues
        const svTop = [top0, top1, top2, top3, top4, top5];
        const svSlot = [slot0, slot1, slot2, slot3, slot4, slot5];
        saved.forEach((key, visualSlot) => {
          const idx = ALL_CARD_KEYS.indexOf(key);
          svTop[idx].value = visualSlot * STEP;
          svSlot[idx].value = visualSlot;
        });
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId]);

  // ── Persist order to AsyncStorage ────────────────────────────────────────
  const saveOrder = useCallback(
    (slotToKeyIdx: number[]) => {
      const newOrder = slotToKeyIdx.map((idx) => ALL_CARD_KEYS[idx]) as CardKey[];
      AsyncStorage.setItem(storageKey(tripId), JSON.stringify(newOrder)).catch(() => {});
    },
    [tripId],
  );

  // ── Drag gestures ─────────────────────────────────────────────────────────
  // One Pan gesture per card. All SharedValues are captured as direct references
  // (not via array) so Reanimated's Babel plugin can serialize them reliably.
  const dragGestures = useMemo(() => {
    function makeGesture(
      cardIdx: number,
      mySY: SharedValue<number>,
      myTop: SharedValue<number>,
      myScale: SharedValue<number>,
      mySlot: SharedValue<number>,
    ) {
      return Gesture.Pan()
        .onBegin(() => {
          'worklet';
          // Capture start position in a SharedValue so onUpdate can read it
          mySY.value = myTop.value;
          myScale.value = withSpring(1.03, SPRING_CFG);
        })
        .onUpdate(({ translationY }) => {
          'worklet';
          const newTop = Math.max(0, Math.min(5 * STEP, mySY.value + translationY));
          myTop.value = newTop;

          const hoverSlot = Math.round(newTop / STEP);
          const currentSlot = mySlot.value;

          if (hoverSlot !== currentSlot) {
            // Move the displaced card to currentSlot using the helper worklet
            doSwap(
              cardIdx, hoverSlot, currentSlot,
              slot0, top0, slot1, top1, slot2, top2,
              slot3, top3, slot4, top4, slot5, top5,
            );
            mySlot.value = hoverSlot;
          }
        })
        .onEnd(() => {
          'worklet';
          const finalSlot = mySlot.value;
          myTop.value = withSpring(finalSlot * STEP, SPRING_CFG);
          myScale.value = withSpring(1.0, SPRING_CFG);
          // Build result and hand off to JS thread for persisting
          const result = buildResult(slot0, slot1, slot2, slot3, slot4, slot5);
          runOnJS(saveOrder)(result);
        });
    }

    return [
      makeGesture(0, startY0, top0, scale0, slot0),
      makeGesture(1, startY1, top1, scale1, slot1),
      makeGesture(2, startY2, top2, scale2, slot2),
      makeGesture(3, startY3, top3, scale3, slot3),
      makeGesture(4, startY4, top4, scale4, slot4),
      makeGesture(5, startY5, top5, scale5, slot5),
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveOrder]); // SharedValues are stable refs — no need to list them

  const handleEnterEditMode = useCallback(() => {
    if (reorderEnabled) setEditMode(true);
  }, [reorderEnabled]);
  const handleExitEditMode = useCallback(() => setEditMode(false), []);

  return (
    <View>
      {editMode && (
        <View style={styles.editBar}>
          <View style={styles.editBarLeft}>
            <Ionicons name="reorder-three-outline" size={18} color="#AAA" />
            <Text style={styles.editHint}>Hold & drag to reorder</Text>
          </View>
          <TouchableOpacity onPress={handleExitEditMode} hitSlop={8}>
            <Text style={styles.doneText}>Done</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={{ height: 6 * STEP - GAP }}>
        {ALL_CARD_KEYS.map((key, idx) => {
          const topSVs = [top0, top1, top2, top3, top4, top5];
          const scaleSVs = [scale0, scale1, scale2, scale3, scale4, scale5];
          return (
            <AnimatedCard
              key={key}
              topSV={topSVs[idx]}
              scaleSV={scaleSVs[idx]}
              editMode={editMode}
              dragGesture={dragGestures[idx]}
              onEnterEditMode={handleEnterEditMode}
            >
              {renderCard(key, editMode)}
            </AnimatedCard>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  editBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
    paddingBottom: 10,
  },
  editBarLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  editHint: {
    fontSize: 13,
    color: '#AAA',
  },
  doneText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#D85A30',
  },
});
