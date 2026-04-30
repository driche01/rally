/**
 * MultiDatePicker — pick any number of individual days in one calendar.
 *
 * Built for the new-trip form's date-options UX: planner taps every day
 * they're considering for the trip across one or more weeks, hits
 * Confirm, and the form groups consecutive days into ranges as poll
 * options. Non-consecutive picks become separate ranges automatically.
 *
 * Differs from DateRangePicker (which is start→end pair selection) and
 * SingleDatePicker (one day). This is "tap-each-day-individually" with
 * a summary that previews how many ranges Rally will create.
 *
 * Confirm callback gets the raw set of ISO 'YYYY-MM-DD' strings —
 * grouping into ranges is the caller's responsibility (helper exposed
 * below).
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Calendar } from 'react-native-calendars';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface Props {
  visible: boolean;
  /** Initial selected days as ISO 'YYYY-MM-DD'. Caller controls — picker
   *  starts from these on each open. */
  value: string[];
  onConfirm: (days: string[]) => void;
  onClose: () => void;
  title?: string;
  confirmLabel?: string;
  /** When true, removes the minDate constraint so past dates are pickable. */
  allowPastDates?: boolean;
  /** Override the default minDate (today). ISO 'YYYY-MM-DD'. Useful when
   *  scoping the picker to a window — e.g. respondents picking days they're
   *  free inside the planner's date range. Ignored if `allowPastDates` is true. */
  minDate?: string;
  /** Cap the latest selectable day. ISO 'YYYY-MM-DD'. */
  maxDate?: string;
}

export interface DateGroup {
  start: string; // ISO
  end: string;   // ISO (inclusive). Same as start for a 1-day group.
}

/**
 * Group an unsorted set of ISO date strings into consecutive ranges.
 * Days that are exactly one day apart collapse into the same range.
 * Output is sorted by start date.
 */
export function groupConsecutiveDays(days: string[]): DateGroup[] {
  if (days.length === 0) return [];
  const sorted = [...days].sort();
  const groups: DateGroup[] = [];
  let groupStart = sorted[0];
  let groupEnd = sorted[0];

  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(groupEnd + 'T12:00:00');
    const curr = new Date(sorted[i] + 'T12:00:00');
    const dayDiff = Math.round((curr.getTime() - prev.getTime()) / 86400000);
    if (dayDiff === 1) {
      groupEnd = sorted[i];
    } else {
      groups.push({ start: groupStart, end: groupEnd });
      groupStart = sorted[i];
      groupEnd = sorted[i];
    }
  }
  groups.push({ start: groupStart, end: groupEnd });
  return groups;
}

type MarkedDates = Record<string, {
  startingDay?: boolean;
  endingDay?: boolean;
  color?: string;
  textColor?: string;
}>;

function buildMarkedDates(days: string[]): MarkedDates {
  // Highlight each tapped day. Where consecutive days appear, we render
  // them as a continuous green band (matching DateRangePicker's look).
  const accentDark = '#0F3F2E';
  const accentLight = '#DFE8D2';
  const sorted = [...days].sort();
  const marks: MarkedDates = {};
  if (sorted.length === 0) return marks;

  const groups = groupConsecutiveDays(sorted);
  const dayMs = 86400000;
  for (const g of groups) {
    if (g.start === g.end) {
      marks[g.start] = { startingDay: true, endingDay: true, color: accentDark, textColor: '#fff' };
      continue;
    }
    const sMs = new Date(g.start).getTime();
    const eMs = new Date(g.end).getTime();
    for (let ms = sMs; ms <= eMs; ms += dayMs) {
      const d = new Date(ms).toISOString().slice(0, 10);
      if (d === g.start) {
        marks[d] = { startingDay: true, color: accentDark, textColor: '#fff' };
      } else if (d === g.end) {
        marks[d] = { endingDay: true, color: accentDark, textColor: '#fff' };
      } else {
        marks[d] = { color: accentLight, textColor: '#163026' };
      }
    }
  }
  return marks;
}

type SelectMode = 'day' | 'weekend' | 'week' | 'month';

const MODE_HINTS: Record<SelectMode, string> = {
  day:     "Tap two days to make a range. Tap more days for additional ranges.",
  weekend: "Tap any day to add the Sat + Sun of that weekend.",
  week:    "Tap any day to add the full Sun–Sat week.",
  month:   "Tap any day to add the entire month.",
};

/**
 * Build the inclusive list of ISO 'YYYY-MM-DD' strings from `a` to `b`.
 * Order-independent: the earlier date is always the start.
 */
function rangeBetween(a: string, b: string): string[] {
  const [start, end] = a <= b ? [a, b] : [b, a];
  const out: string[] = [];
  const s = new Date(start + 'T12:00:00');
  const e = new Date(end + 'T12:00:00');
  for (let d = new Date(s); d.getTime() <= e.getTime(); d.setDate(d.getDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/**
 * Find every consecutive day connected to `iso` within `days`.
 * Used to remove an entire range when the planner taps any day inside
 * it. Returns the connected component (sorted asc).
 */
function rangeContaining(iso: string, days: string[]): string[] {
  const set = new Set(days);
  if (!set.has(iso)) return [];
  const out: string[] = [iso];
  // Walk backward
  let curr = new Date(iso + 'T12:00:00');
  while (true) {
    curr.setDate(curr.getDate() - 1);
    const prev = curr.toISOString().slice(0, 10);
    if (set.has(prev)) out.unshift(prev);
    else break;
  }
  // Walk forward
  curr = new Date(iso + 'T12:00:00');
  while (true) {
    curr.setDate(curr.getDate() + 1);
    const next = curr.toISOString().slice(0, 10);
    if (set.has(next)) out.push(next);
    else break;
  }
  return out;
}

const MODE_LABELS: Record<SelectMode, string> = {
  day: 'Days', weekend: 'Weekends', week: 'Weeks', month: 'Months',
};

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Fri + Sat + Sun for the weekend bracketing the tapped day.
 *  Anchored on the Saturday and extended one day in each direction. */
function weekendDays(iso: string): string[] {
  const d = new Date(iso + 'T12:00:00');
  const dow = d.getDay();
  // Find the Saturday of this weekend.
  const sat = new Date(d);
  if (dow === 6) {
    /* already Saturday */
  } else if (dow === 5) {
    // Friday — Saturday is tomorrow.
    sat.setDate(d.getDate() + 1);
  } else if (dow === 0) {
    // Sunday — Saturday is yesterday.
    sat.setDate(d.getDate() - 1);
  } else {
    // Mon–Thu — fast-forward to the upcoming Saturday.
    sat.setDate(d.getDate() + (6 - dow));
  }
  const fri = new Date(sat);
  fri.setDate(sat.getDate() - 1);
  const sun = new Date(sat);
  sun.setDate(sat.getDate() + 1);
  return [isoDate(fri), isoDate(sat), isoDate(sun)];
}

/** All 7 days of the calendar week (Sun–Sat) containing the tapped day. */
function weekDays(iso: string): string[] {
  const d = new Date(iso + 'T12:00:00');
  const sunday = new Date(d);
  sunday.setDate(d.getDate() - d.getDay());
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(sunday);
    day.setDate(sunday.getDate() + i);
    return isoDate(day);
  });
}

/** Every day of the month containing the tapped day. */
function monthDays(iso: string): string[] {
  const d = new Date(iso + 'T12:00:00');
  const y = d.getFullYear();
  const m = d.getMonth();
  const last = new Date(y, m + 1, 0).getDate();
  return Array.from({ length: last }, (_, i) =>
    isoDate(new Date(y, m, i + 1)),
  );
}

export function MultiDatePicker({
  visible,
  value,
  onConfirm,
  onClose,
  title = 'Pick the days you’re considering',
  confirmLabel = 'Confirm dates',
  allowPastDates = false,
  minDate: minDateProp,
  maxDate,
}: Props) {
  const insets = useSafeAreaInsets();
  const [days, setDays] = useState<string[]>(value);
  const [mode, setMode] = useState<SelectMode>('day');
  // Day-mode is range-pair input. After the planner taps day A,
  // pendingAnchor holds A and the next tap completes A→B as a range.
  // null means "no pending anchor — the next tap starts a new range."
  const [pendingAnchor, setPendingAnchor] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setDays(value);
      setMode('day');
      setPendingAnchor(null);
    }
  }, [visible, value]);

  const groups = useMemo(() => groupConsecutiveDays(days), [days]);

  function toggleBlock(blockDays: string[], todayIso: string) {
    setDays((prev) => {
      const set = new Set(prev);
      // Filter to days the calendar actually allows: ≥ today (unless
      // allowPastDates) and ≤ maxDate. A "this week"-style tap shouldn't
      // add days that fall outside the window.
      const valid = blockDays.filter((d) => {
        if (!allowPastDates && d < todayIso) return false;
        if (minDateProp && d < minDateProp) return false;
        if (maxDate && d > maxDate) return false;
        return true;
      });
      if (valid.length === 0) return prev;
      const allSelected = valid.every((d) => set.has(d));
      if (allSelected) valid.forEach((d) => set.delete(d));
      else valid.forEach((d) => set.add(d));
      return Array.from(set);
    });
  }

  function handleDayPress(day: { dateString: string }) {
    const todayIso = new Date().toISOString().slice(0, 10);
    if (mode === 'day') {
      // Multi-range tap pattern:
      //   • Tap 1 (no pending anchor): select the day, set as the anchor
      //     for the next tap to complete a range with.
      //   • Tap 2 (anchor set, different day): fill a range anchor→tap and
      //     UNION with existing days. Clear anchor.
      //   • Tap 2 on the same day as anchor: deselect the anchor.
      //   • Tap on a day already inside a committed range (no anchor):
      //     remove the entire connected range that day belongs to.
      const tapped = day.dateString;

      if (pendingAnchor !== null) {
        if (pendingAnchor === tapped) {
          // Deselect the anchor — same-day tap.
          setDays((prev) => prev.filter((d) => d !== pendingAnchor));
        } else {
          // Complete the range and union with existing selection.
          const filled = rangeBetween(pendingAnchor, tapped);
          const valid = filled.filter((d) => {
            if (!allowPastDates && d < todayIso) return false;
            if (minDateProp && d < minDateProp) return false;
            if (maxDate && d > maxDate) return false;
            return true;
          });
          setDays((prev) => Array.from(new Set([...prev, ...valid])));
        }
        setPendingAnchor(null);
        return;
      }

      // No pending anchor.
      if (days.includes(tapped)) {
        // Tap landed inside an existing committed range — remove that
        // range entirely.
        const range = new Set(rangeContaining(tapped, days));
        setDays((prev) => prev.filter((d) => !range.has(d)));
        return;
      }

      // Fresh tap — start a new range anchor.
      setDays((prev) => [...prev, tapped]);
      setPendingAnchor(tapped);
      return;
    }
    if (mode === 'weekend') return toggleBlock(weekendDays(day.dateString), todayIso);
    if (mode === 'week')    return toggleBlock(weekDays(day.dateString), todayIso);
    if (mode === 'month')   return toggleBlock(monthDays(day.dateString), todayIso);
  }

  function handleClear() {
    setDays([]);
  }

  function handleConfirm() {
    onConfirm(days);
    onClose();
  }

  const today = new Date().toISOString().slice(0, 10);
  // Resolve the effective minimum:
  //  • If caller passed `minDate`, always honor it (works for past windows).
  //  • Else if `allowPastDates`, no minimum.
  //  • Else default to today (block past dates).
  const effectiveMin = minDateProp ?? (allowPastDates ? undefined : today);
  const marked = buildMarkedDates(days);

  // Summary line — quick preview of how many ranges the picks will become.
  const summary = days.length === 0
    ? MODE_HINTS[mode]
    : `${days.length} day${days.length === 1 ? '' : 's'} · ${groups.length} range${groups.length === 1 ? '' : 's'}`;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[styles.container, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 }]}>
        <View style={styles.inner}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} hitSlop={8}>
            <Text style={styles.cancelBtn}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.title}>{title}</Text>
          <TouchableOpacity onPress={handleClear} hitSlop={8} disabled={days.length === 0}>
            <Text style={[styles.clearBtn, days.length === 0 && { color: '#A0C0B2' }]}>Clear</Text>
          </TouchableOpacity>
        </View>

        {/* Mode pills — quick-select day blocks instead of tapping each day */}
        <View style={styles.modeRow}>
          {(['day', 'weekend', 'week', 'month'] as SelectMode[]).map((m) => {
            const sel = mode === m;
            return (
              <Pressable
                key={m}
                onPress={() => setMode(m)}
                style={[styles.modePill, sel && styles.modePillSelected]}
                accessibilityRole="radio"
                accessibilityState={{ selected: sel }}
                accessibilityLabel={MODE_LABELS[m]}
              >
                <Text style={[styles.modePillText, sel && styles.modePillTextSelected]}>
                  {MODE_LABELS[m]}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.summary}>
          <Text style={styles.summaryText}>{summary}</Text>
          {days.length > 0 ? (
            <Text style={styles.summarySub}>
              {mode === 'day'
                ? pendingAnchor !== null
                  ? 'Tap a second day to fill the range, or tap the same day to clear.'
                  : 'Tap any day to start a new range. Tap an existing range to remove it.'
                : `${MODE_HINTS[mode]} Tap again to deselect a block.`}
            </Text>
          ) : null}
        </View>

        <Calendar
          markingType="period"
          markedDates={marked}
          onDayPress={handleDayPress}
          minDate={effectiveMin}
          maxDate={maxDate}
          theme={{
            calendarBackground: '#FFFCF6',
            textSectionTitleColor: '#5F685F',
            selectedDayBackgroundColor: '#0F3F2E',
            selectedDayTextColor: '#FFFFFF',
            todayTextColor: '#0F3F2E',
            dayTextColor: '#163026',
            textDisabledColor: '#9DA8A0',
            arrowColor: '#0F3F2E',
            monthTextColor: '#163026',
            textDayFontWeight: '500',
            textMonthFontWeight: '600',
            textDayHeaderFontWeight: '500',
          }}
          style={styles.calendar}
        />

        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.confirmBtn, days.length === 0 && styles.confirmBtnDisabled]}
            onPress={handleConfirm}
            disabled={days.length === 0}
            activeOpacity={0.8}
          >
            <Text style={styles.confirmText}>
              {confirmLabel}
              {groups.length > 0 ? ` (${groups.length})` : ''}
            </Text>
          </TouchableOpacity>
        </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  // On native (iOS pageSheet) the modal already sits inside a centered
  // sheet so we let it stretch. On web Modal renders full-bleed, so
  // center the content and cap its width at a reasonable phone-ish size
  // — otherwise the calendar grid stretches across the whole desktop
  // viewport, which is what your earlier screenshot caught.
  container: {
    flex: 1,
    backgroundColor: '#FFFCF6',
    ...Platform.select({ web: { alignItems: 'center' } }),
  },
  inner: {
    flex: 1,
    width: '100%',
    ...Platform.select({ web: { maxWidth: 520 } }),
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  cancelBtn: { fontSize: 16, color: '#5F685F' },
  clearBtn:  { fontSize: 16, color: '#0F3F2E' },
  title:     { fontSize: 17, fontWeight: '600', color: '#163026', flex: 1, textAlign: 'center', paddingHorizontal: 8 },

  modeRow: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 20,
    marginBottom: 10,
  },
  modePill: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: '#D9CCB6',
    backgroundColor: '#FFFCF6',
    alignItems: 'center',
  },
  modePillSelected: {
    borderColor: '#0F3F2E',
    backgroundColor: '#DFE8D2',
  },
  modePillText: { fontSize: 13, fontWeight: '600', color: '#5F685F' },
  modePillTextSelected: { color: '#0F3F2E' },

  summary: {
    marginHorizontal: 20,
    marginBottom: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#0F3F2E',
    backgroundColor: '#DFE8D2',
  },
  summaryText: { fontSize: 14, fontWeight: '700', color: '#163026' },
  summarySub:  { fontSize: 12, color: '#5F685F', marginTop: 2 },

  calendar: { marginHorizontal: 8 },

  footer: { paddingHorizontal: 20, paddingTop: 16 },
  confirmBtn: {
    backgroundColor: '#0F3F2E',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  confirmBtnDisabled: { backgroundColor: '#A0C0B2' },
  confirmText: { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },
});
