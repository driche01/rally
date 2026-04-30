/**
 * DateHeatmap — calendar view showing per-day vote density for date polls.
 *
 * When the planner sets up a multi-range dates poll, each range expands
 * to per-day poll options (`expandRangesToDayLabels` in trips/new.tsx).
 * Voting per day produces a per-day count map. This component renders
 * those counts as a calendar where each available day is shaded by how
 * many people picked it — darker green = more people available.
 *
 * Used in two places:
 *   - AggregateResultsCard (dashboard) for the planner
 *   - /results/[token] public page for participants + planner
 *
 * Inputs are deliberately untyped to the Poll/PollOption types so this
 * component composes with both the dashboard's PollWithOptions and the
 * public page's lighter-weight option shape.
 */
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { parseDateRangeLabel } from '@/lib/pollFormUtils';

interface OptionLike {
  id: string;
  label: string;
}

interface Props {
  options: OptionLike[];
  /** `option_id → vote_count`. Missing options default to 0. */
  counts: Record<string, number>;
  /** Highest visible weight on the heat scale. Defaults to max-counts (or 1 if all 0). */
  maxScale?: number;
  /**
   * Interactive selection mode — when true, day cells become tappable.
   * Used by the DecisionQueueCard's "Pick" calendar so the planner can
   * lock in a date set while seeing the heatmap of who voted for what.
   */
  selectable?: boolean;
  /** Currently-selected option IDs (only used when `selectable`). */
  selectedIds?: string[];
  /** Tap handler for a day cell (only used when `selectable`). */
  onToggle?: (optionId: string) => void;
}

interface DayCell {
  optionId: string;
  date: Date;
  votes: number;
}

const HEAT_PALETTE = [
  '#F3F1EC', // 0 votes — neutral surface
  '#E8E5DA', // 1
  '#DFE8D2', // green-soft
  '#A8C190', // green-soft + darker
  '#5D8B4F', // mid green
  '#2A5E3B', // deep green
  '#0F3F2E', // brand green
];

function shade(votes: number, max: number): string {
  if (max <= 0 || votes <= 0) return HEAT_PALETTE[0];
  const ratio = Math.min(1, votes / max);
  const idx = Math.min(HEAT_PALETTE.length - 1, Math.max(1, Math.round(ratio * (HEAT_PALETTE.length - 1))));
  return HEAT_PALETTE[idx];
}

function textColorForShade(votes: number, max: number): string {
  if (max <= 0 || votes <= 0) return '#A0A0A0';
  return votes / max > 0.4 ? '#FFFFFF' : '#163026';
}

export function DateHeatmap({
  options,
  counts,
  maxScale,
  selectable = false,
  selectedIds,
  onToggle,
}: Props) {
  const selectedSet = useMemo(() => new Set(selectedIds ?? []), [selectedIds]);
  // Parse each option label into a Date. Skip anything that doesn't parse
  // (defensive — caller should only pass per-day options).
  const days = useMemo<DayCell[]>(() => {
    const out: DayCell[] = [];
    for (const o of options) {
      const range = parseDateRangeLabel(o.label);
      if (!range) continue;
      const sameDay =
        range.start.getFullYear() === range.end.getFullYear() &&
        range.start.getMonth() === range.end.getMonth() &&
        range.start.getDate() === range.end.getDate();
      if (!sameDay) continue;
      out.push({
        optionId: o.id,
        date: range.start,
        votes: counts[o.id] ?? 0,
      });
    }
    return out.sort((a, b) => a.date.getTime() - b.date.getTime());
  }, [options, counts]);

  const max = maxScale ?? Math.max(1, ...days.map((d) => d.votes));

  // Group by year-month; allow paging if multiple months.
  const months = useMemo(() => {
    const m = new Map<string, DayCell[]>();
    for (const d of days) {
      const key = `${d.date.getFullYear()}-${String(d.date.getMonth()).padStart(2, '0')}`;
      const arr = m.get(key) ?? [];
      arr.push(d);
      m.set(key, arr);
    }
    return Array.from(m.entries()).map(([key, dates]) => {
      const [y, mo] = key.split('-').map(Number);
      return { year: y, month: mo, days: dates };
    });
  }, [days]);

  const [pageIdx, setPageIdx] = useState(0);
  if (days.length === 0) return null;

  const page = months[pageIdx];
  if (!page) return null;
  const pageDayMap = new Map(page.days.map((d) => [d.date.getDate(), d]));

  const firstDayOfWeek = new Date(page.year, page.month, 1).getDay();
  const daysInMonth = new Date(page.year, page.month + 1, 0).getDate();
  const trailingNulls = (7 - ((firstDayOfWeek + daysInMonth) % 7)) % 7;
  const cells: Array<{ day: number | null }> = [
    ...Array(firstDayOfWeek).fill(null).map(() => ({ day: null })),
    ...Array.from({ length: daysInMonth }, (_, i) => ({ day: i + 1 })),
    ...Array(trailingNulls).fill(null).map(() => ({ day: null })),
  ];

  const monthLabel = new Date(page.year, page.month, 1).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <Pressable
          onPress={() => setPageIdx((i) => Math.max(0, i - 1))}
          disabled={pageIdx === 0}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Previous month"
        >
          <Ionicons name="chevron-back" size={16} color={pageIdx === 0 ? '#D1D5DB' : '#5F685F'} />
        </Pressable>
        <Text style={styles.monthLabel}>{monthLabel}</Text>
        <Pressable
          onPress={() => setPageIdx((i) => Math.min(months.length - 1, i + 1))}
          disabled={pageIdx >= months.length - 1}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Next month"
        >
          <Ionicons name="chevron-forward" size={16} color={pageIdx >= months.length - 1 ? '#D1D5DB' : '#5F685F'} />
        </Pressable>
      </View>

      <View style={styles.dowRow}>
        {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => (
          <Text key={d} style={styles.dowText}>{d}</Text>
        ))}
      </View>

      <View style={styles.grid}>
        {cells.map((c, i) => {
          if (c.day === null) {
            return <View key={`e-${i}`} style={styles.cell} />;
          }
          const dayCell = pageDayMap.get(c.day);
          if (!dayCell) {
            return (
              <View key={`d-${c.day}`} style={styles.cell}>
                <Text style={[styles.dayText, { color: '#D1D5DB' }]}>{c.day}</Text>
              </View>
            );
          }
          const bg = shade(dayCell.votes, max);
          const fg = textColorForShade(dayCell.votes, max);
          const isSelected = selectedSet.has(dayCell.optionId);
          const pillStyle = [
            styles.dayPill,
            { backgroundColor: bg },
            isSelected && styles.dayPillSelected,
          ];
          const inner = (
            <View style={pillStyle}>
              <Text style={[styles.dayText, { color: isSelected ? '#0F3F2E' : fg }]}>{c.day}</Text>
              {dayCell.votes > 0 ? (
                <Text style={[styles.dayCount, { color: isSelected ? '#0F3F2E' : fg }]}>{dayCell.votes}</Text>
              ) : null}
            </View>
          );
          if (selectable && onToggle) {
            return (
              <Pressable
                key={`d-${c.day}`}
                style={styles.cell}
                onPress={() => onToggle(dayCell.optionId)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: isSelected }}
                accessibilityLabel={`${c.day}, ${dayCell.votes} ${dayCell.votes === 1 ? 'vote' : 'votes'}`}
              >
                {inner}
              </Pressable>
            );
          }
          return (
            <View key={`d-${c.day}`} style={styles.cell}>
              {inner}
            </View>
          );
        })}
      </View>

      <View style={styles.legend}>
        <Text style={styles.legendLabel}>Fewer</Text>
        <View style={styles.legendStripe}>
          {HEAT_PALETTE.map((c) => (
            <View key={c} style={[styles.legendCell, { backgroundColor: c }]} />
          ))}
        </View>
        <Text style={styles.legendLabel}>More</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  monthLabel: { fontSize: 13, fontWeight: '700', color: '#163026' },
  dowRow: { flexDirection: 'row' },
  dowText: { flex: 1, textAlign: 'center', fontSize: 11, fontWeight: '500', color: '#5F685F' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: {
    width: `${100 / 7}%`,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 2,
  },
  dayPill: {
    width: '90%',
    height: '90%',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayPillSelected: {
    borderWidth: 2.5,
    borderColor: '#0F3F2E',
  },
  dayText: { fontSize: 12, fontWeight: '600' },
  dayCount: { fontSize: 9, fontWeight: '700', marginTop: -1 },

  legend: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingTop: 4,
  },
  legendLabel: { fontSize: 10, color: '#888' },
  legendStripe: { flexDirection: 'row', flex: 1, gap: 2 },
  legendCell: { flex: 1, height: 8, borderRadius: 2 },
});
