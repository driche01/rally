import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { Divider, Input } from '@/components/ui';
import {
  MONTH_NAMES,
  DAY_NAMES,
  DURATION_OPTIONS,
  stripTime,
  isSameDay,
  fmtShort,
  fmtRange,
  chunkArray,
} from '@/lib/pollFormUtils';
import type { DateRange } from '@/types/polls';

// ── CalendarPicker ────────────────────────────────────────────────────────────

function CalendarPicker({
  ranges,
  onRangesChange,
  accentColor = '#D85A30',
}: {
  ranges: DateRange[];
  onRangesChange: (r: DateRange[]) => void;
  accentColor?: string;
}) {
  const today = stripTime(new Date());
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [pendingStart, setPendingStart] = useState<Date | null>(null);

  const isCurrentMonth = viewYear === today.getFullYear() && viewMonth === today.getMonth();

  function prevMonth() {
    if (isCurrentMonth) return;
    if (viewMonth === 0) { setViewYear((y) => y - 1); setViewMonth(11); }
    else setViewMonth((m) => m - 1);
  }

  function nextMonth() {
    if (viewMonth === 11) { setViewYear((y) => y + 1); setViewMonth(0); }
    else setViewMonth((m) => m + 1);
  }

  const firstDayOfWeek = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const trailingNulls = (7 - ((firstDayOfWeek + daysInMonth) % 7)) % 7;
  const cells: (Date | null)[] = [
    ...Array(firstDayOfWeek).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => new Date(viewYear, viewMonth, i + 1)),
    ...Array(trailingNulls).fill(null),
  ];

  type DayState = 'start' | 'end' | 'inRange' | 'single' | 'pending' | 'none';

  function getDayState(d: Date): DayState {
    if (pendingStart && isSameDay(d, pendingStart)) return 'pending';
    for (const r of ranges) {
      if (isSameDay(d, r.start) && isSameDay(d, r.end)) return 'single';
      if (isSameDay(d, r.start)) return 'start';
      if (isSameDay(d, r.end)) return 'end';
      if (d.getTime() > r.start.getTime() && d.getTime() < r.end.getTime()) return 'inRange';
    }
    return 'none';
  }

  function handleDayPress(d: Date) {
    const clean = stripTime(d);
    if (clean < today) return;
    if (!pendingStart) {
      setPendingStart(clean);
    } else {
      const start = clean < pendingStart ? clean : pendingStart;
      const end = clean < pendingStart ? pendingStart : clean;
      onRangesChange([...ranges, { start, end }]);
      setPendingStart(null);
    }
  }

  const weeks = chunkArray(cells, 7);

  return (
    <View className="rounded-2xl border border-line bg-cream-warm p-4">
      {/* Month nav */}
      <View className="mb-3 flex-row items-center justify-between">
        <Pressable onPress={prevMonth} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} className="p-1" disabled={isCurrentMonth}>
          <Ionicons name="chevron-back" size={20} color={isCurrentMonth ? '#D4D4D4' : '#6B6B6B'} />
        </Pressable>
        <Text className="text-sm font-semibold text-ink">
          {MONTH_NAMES[viewMonth]} {viewYear}
        </Text>
        <Pressable onPress={nextMonth} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} className="p-1">
          <Ionicons name="chevron-forward" size={20} color="#6B6B6B" />
        </Pressable>
      </View>

      {/* Day-of-week headers */}
      <View className="mb-1 flex-row">
        {DAY_NAMES.map((d) => (
          <View key={d} style={{ flex: 1 }} className="items-center">
            <Text className="text-xs font-medium text-muted">{d}</Text>
          </View>
        ))}
      </View>

      {/* Day grid */}
      {weeks.map((week, wi) => (
        <View key={wi} className="flex-row">
          {week.map((day, di) => {
            if (!day) return <View key={di} style={{ flex: 1 }} />;
            const isPast = stripTime(day) < today;
            const state = getDayState(day);
            const isEndpoint = ['start', 'end', 'single', 'pending'].includes(state);
            const isIn = state === 'inRange';
            return (
              <Pressable
                key={di}
                onPress={() => handleDayPress(day)}
                style={{ flex: 1 }}
                className="items-center py-0.5"
                disabled={isPast}
              >
                <View
                  className="h-8 w-8 items-center justify-center rounded-full"
                  style={isPast ? {} : isEndpoint ? { backgroundColor: accentColor } : isIn ? { backgroundColor: accentColor + '20' } : {}}
                >
                  <Text
                    className="text-xs"
                    style={isPast
                      ? { color: '#D4D4D4' }
                      : isEndpoint
                        ? { fontWeight: '700', color: '#F4ECDF' }
                        : isIn
                          ? { color: accentColor }
                          : { color: '#404040' }
                    }
                  >
                    {day.getDate()}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      ))}

      {/* Hint */}
      <Text className="mt-2 text-center text-xs text-muted">
        {pendingStart
          ? `Now tap an end date (started ${fmtShort(pendingStart)})`
          : 'Tap a start date to add a period'}
      </Text>

      {/* Selected range chips */}
      {ranges.length > 0 ? (
        <View className="mt-3 flex-row flex-wrap gap-2">
          {ranges.map((r, i) => (
            <View
              key={i}
              className="flex-row items-center gap-1 rounded-full border px-3 py-1.5"
              style={{ borderColor: accentColor + '60', backgroundColor: accentColor + '12' }}
            >
              <Text className="text-sm" style={{ color: accentColor }}>{fmtRange(r)}</Text>
              <Pressable
                onPress={() => onRangesChange(ranges.filter((_, j) => j !== i))}
                hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
              >
                <Ionicons name="close" size={13} color={accentColor} />
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

// ── DatesSection ──────────────────────────────────────────────────────────────

const DURATION_UNITS = ['days', 'weeks', 'months'] as const;
type DurationUnit = (typeof DURATION_UNITS)[number];

export interface DatesSectionProps {
  datesTitle: string;
  onDatesTitleChange: (v: string) => void;
  dateRanges: DateRange[];
  onDateRangesChange: (ranges: DateRange[]) => void;
  durationTitle: string;
  onDurationTitleChange: (v: string) => void;
  selectedDurations: string[];
  onDurationToggle: (d: string) => void;
  customDurationInput: string;
  onCustomDurationInputChange: (v: string) => void;
  customDurationUnit: DurationUnit;
  onCustomDurationUnitChange: (u: DurationUnit) => void;
  onCustomDurationAdd: () => void;
  accentColor?: string;
}

export function DatesSection({
  datesTitle,
  onDatesTitleChange,
  dateRanges,
  onDateRangesChange,
  durationTitle,
  onDurationTitleChange,
  selectedDurations,
  onDurationToggle,
  customDurationInput,
  onCustomDurationInputChange,
  customDurationUnit,
  onCustomDurationUnitChange,
  onCustomDurationAdd,
  accentColor = '#D85A30',
}: DatesSectionProps) {
  return (
    <>
      {/* Duration — appears before the calendar */}
      <View className="gap-3">
        <Input
          label="Duration question"
          value={durationTitle}
          onChangeText={onDurationTitleChange}
          placeholder="How long's the trip?"
        />

        {/* Preset + custom duration chips */}
        <View className="flex-row flex-wrap gap-2">
          {DURATION_OPTIONS.map((dur) => {
            const sel = selectedDurations.includes(dur);
            return (
              <Pressable
                key={dur}
                onPress={() => onDurationToggle(dur)}
                className="rounded-full border px-4 py-2"
                style={sel
                  ? { borderColor: accentColor, backgroundColor: accentColor }
                  : { borderColor: '#E7DDCF', backgroundColor: '#F4ECDF' }
                }
                accessibilityRole="checkbox"
                accessibilityState={{ checked: sel }}
              >
                <Text className="text-sm font-medium" style={{ color: sel ? '#F4ECDF' : '#525252' }}>
                  {dur}
                </Text>
              </Pressable>
            );
          })}
          {/* Custom (user-added) duration chips */}
          {selectedDurations
            .filter((d) => !DURATION_OPTIONS.includes(d))
            .map((dur) => (
              <View
                key={dur}
                className="flex-row items-center gap-1 rounded-full border px-4 py-2"
                style={{ borderColor: accentColor, backgroundColor: accentColor }}
              >
                <Text className="text-sm font-medium text-white">{dur}</Text>
                <Pressable
                  onPress={() => onDurationToggle(dur)}
                  hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                >
                  <Ionicons name="close" size={13} color="white" />
                </Pressable>
              </View>
            ))}
        </View>

        {/* Custom duration: number + unit picker */}
        <View className="flex-row items-center gap-2">
          <TextInput
            value={customDurationInput}
            onChangeText={(t) => onCustomDurationInputChange(t.replace(/[^0-9]/g, ''))}
            onSubmitEditing={onCustomDurationAdd}
            returnKeyType="done"
            keyboardType="number-pad"
            placeholder="e.g. 5"
            maxLength={3}
            className="w-20 min-h-[44px] rounded-2xl border border-line bg-cream-warm px-4 py-2 text-sm text-ink text-center"
            placeholderTextColor="#A8A8A8"
          />
          {DURATION_UNITS.map((u) => {
            const sel = customDurationUnit === u;
            return (
              <Pressable
                key={u}
                onPress={() => onCustomDurationUnitChange(u)}
                className="flex-1 items-center justify-center rounded-2xl border min-h-[44px] px-1"
                style={sel
                  ? { borderColor: accentColor, backgroundColor: accentColor }
                  : { borderColor: '#E7DDCF', backgroundColor: '#F4ECDF' }
                }
                accessibilityRole="radio"
                accessibilityState={{ selected: sel }}
                accessibilityLabel={u}
              >
                <Text className="text-xs font-medium" style={{ color: sel ? '#F4ECDF' : '#525252' }}>
                  {u}
                </Text>
              </Pressable>
            );
          })}
          <Pressable
            onPress={onCustomDurationAdd}
            disabled={!customDurationInput.trim()}
            className="h-11 w-11 items-center justify-center rounded-full"
            style={{ backgroundColor: customDurationInput.trim() ? accentColor : '#E7DDCF' }}
            accessibilityRole="button"
            accessibilityLabel="Add custom duration"
          >
            <Ionicons name="add" size={22} color={customDurationInput.trim() ? '#F4ECDF' : '#A8A8A8'} />
          </Pressable>
        </View>
      </View>

      <Divider />

      {/* Availability calendar — after duration */}
      <Input
        label="Availability question"
        value={datesTitle}
        onChangeText={onDatesTitleChange}
        placeholder="When can ya make it?"
      />
      <CalendarPicker ranges={dateRanges} onRangesChange={onDateRangesChange} accentColor={accentColor} />
    </>
  );
}
