/**
 * Pure helpers for date-picker callers — extracted so consumers that
 * only need `groupConsecutiveDays` don't drag `react-native-calendars`
 * into the bundle by importing from `MultiDatePicker.tsx`.
 */

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
