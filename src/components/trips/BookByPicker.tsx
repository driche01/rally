/**
 * BookByPicker — relative-time pill picker for the book-by date.
 *
 * Replaces the calendar modal in the trip-card flow. 95% of planners
 * think "in 2 weeks," not "Sunday May 10." The pills cover that case in
 * a single tap; "Custom" falls back to the existing SingleDatePicker
 * modal for the long-tail.
 *
 * Behavior:
 *   - Tap a pill → sets the book-by date to (today + N days)
 *   - Tap "Custom" → opens the SingleDatePicker
 *   - Selected pill is the one that matches the currently-set ISO date
 *     (via days-from-today rounding). When the date doesn't match any
 *     pill exactly, "Custom" lights up and shows the chosen date as a
 *     small caption.
 *
 * Output is the same ISO 'YYYY-MM-DD' string the SingleDatePicker
 * produces, so callers don't need to change.
 */
import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SingleDatePicker } from '@/components/SingleDatePicker';
import { formatCadenceDate } from '@/lib/cadence';
import { tapHaptic } from '@/lib/haptics';

interface Props {
  value: string | null;
  onChange: (next: string) => void;
  /** True when the parent's validation flagged this field as missing. */
  hasError?: boolean;
}

interface PillSpec {
  key: string;
  label: string;
  days: number;
}

const PILLS: PillSpec[] = [
  { key: '1w', label: 'In 1 week', days: 7 },
  { key: '2w', label: 'In 2 weeks', days: 14 },
  { key: '3w', label: 'In 3 weeks', days: 21 },
  { key: '1m', label: 'In 1 month', days: 30 },
];

function isoFromDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function daysFromTodayISO(iso: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(iso + 'T12:00:00');
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

function isoFromDaysFromToday(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return isoFromDate(d);
}

export function BookByPicker({ value, onChange, hasError }: Props) {
  const [customOpen, setCustomOpen] = useState(false);

  // Match value to a pill if it lines up exactly with one of the offsets.
  const days = value ? daysFromTodayISO(value) : null;
  const matchedPill = days !== null ? PILLS.find((p) => p.days === days) : null;
  const customSelected = value !== null && matchedPill === undefined;

  function handlePillTap(p: PillSpec) {
    tapHaptic();
    onChange(isoFromDaysFromToday(p.days));
  }

  return (
    <>
      <SingleDatePicker
        visible={customOpen}
        value={value}
        onConfirm={(d) => {
          if (d) onChange(d);
        }}
        onClose={() => setCustomOpen(false)}
        title="When do you need to book by?"
        confirmLabel="Set book-by date"
      />

      <View className="flex-row flex-wrap gap-2">
        {PILLS.map((p) => {
          const sel = matchedPill?.key === p.key;
          return (
            <Pressable
              key={p.key}
              onPress={() => handlePillTap(p)}
              className={`px-4 py-2 rounded-full border-[1.5px] ${sel ? 'border-green bg-green-soft' : hasError ? 'border-red-300 bg-card' : 'border-line bg-card'}`}
              accessibilityRole="radio"
              accessibilityState={{ selected: sel }}
              accessibilityLabel={p.label}
            >
              <Text className={`text-sm font-medium ${sel ? 'text-green' : '#404040'}`} style={{ color: sel ? '#0F3F2E' : '#404040' }}>
                {p.label}
              </Text>
            </Pressable>
          );
        })}
        <Pressable
          onPress={() => setCustomOpen(true)}
          className={`flex-row items-center gap-1 px-4 py-2 rounded-full border-[1.5px] ${customSelected ? 'border-green bg-green-soft' : hasError ? 'border-red-300 bg-card' : 'border-line bg-card'}`}
          accessibilityRole="button"
          accessibilityLabel="Pick a custom book-by date"
        >
          <Ionicons name="calendar-outline" size={14} color={customSelected ? '#0F3F2E' : '#404040'} />
          <Text style={{ fontSize: 14, fontWeight: '500', color: customSelected ? '#0F3F2E' : '#404040' }}>
            Custom
          </Text>
        </Pressable>
      </View>

      {customSelected && value ? (
        <Text style={{ fontSize: 12, color: '#737373' }}>
          {formatCadenceDate(value)}
        </Text>
      ) : null}
    </>
  );
}
