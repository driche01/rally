import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import {
  Modal,
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
  startDate: string | null;
  endDate: string | null;
  onConfirm: (start: string | null, end: string | null) => void;
  onClose: () => void;
  /** Modal header title. Defaults to "Trip dates". */
  title?: string;
  /** Label shown above the start date box. Defaults to "Start". */
  startLabel?: string;
  /** Label shown above the end date box. Defaults to "End". */
  endLabel?: string;
  /** Confirm button text. Defaults to "Confirm dates". */
  confirmLabel?: string;
  /** When true, removes the minDate constraint so past dates can be selected. */
  allowPastDates?: boolean;
}

type MarkedDates = Record<string, {
  startingDay?: boolean;
  endingDay?: boolean;
  color?: string;
  textColor?: string;
  marked?: boolean;
}>;

function buildMarkedDates(start: string | null, end: string | null): MarkedDates {
  if (!start) return {};
  const coral = '#D85A30';
  const coralLight = '#FDEBD6';

  if (!end || start === end) {
    return {
      [start]: { startingDay: true, endingDay: true, color: coral, textColor: '#fff' },
    };
  }

  const marks: MarkedDates = {};
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  const dayMs = 86400000;

  for (let ms = startMs; ms <= endMs; ms += dayMs) {
    const d = new Date(ms).toISOString().slice(0, 10);
    if (d === start) {
      marks[d] = { startingDay: true, color: coral, textColor: '#fff' };
    } else if (d === end) {
      marks[d] = { endingDay: true, color: coral, textColor: '#fff' };
    } else {
      marks[d] = { color: coralLight, textColor: '#262626' };
    }
  }
  return marks;
}

function formatDisplay(date: string | null): string {
  if (!date) return 'Select';
  const [y, m, d] = date.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[parseInt(m, 10) - 1]} ${parseInt(d, 10)}, ${y}`;
}

export function DateRangePicker({
  visible, startDate, endDate, onConfirm, onClose,
  title = 'Trip dates',
  startLabel = 'Start',
  endLabel = 'End',
  confirmLabel = 'Confirm dates',
  allowPastDates = false,
}: Props) {
  const insets = useSafeAreaInsets();
  const [localStart, setLocalStart] = useState<string | null>(startDate);
  const [localEnd, setLocalEnd] = useState<string | null>(endDate);
  // 'start' means next tap sets start, 'end' means next tap sets end
  const [picking, setPicking] = useState<'start' | 'end'>('start');

  // Reset local state when modal opens
  const handleOpen = () => {
    setLocalStart(startDate);
    setLocalEnd(endDate);
    setPicking(startDate ? 'end' : 'start');
  };

  function handleDayPress(day: { dateString: string }) {
    const d = day.dateString;
    if (picking === 'start') {
      setLocalStart(d);
      setLocalEnd(null);
      setPicking('end');
    } else {
      // If tapped before current start, swap
      if (localStart && d < localStart) {
        setLocalStart(d);
        setLocalEnd(localStart);
      } else {
        setLocalEnd(d);
      }
      setPicking('start');
    }
  }

  function handleClear() {
    setLocalStart(null);
    setLocalEnd(null);
    setPicking('start');
  }

  function handleConfirm() {
    onConfirm(localStart, localEnd);
    onClose();
  }

  const markedDates = buildMarkedDates(localStart, localEnd);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
      onShow={handleOpen}
    >
      <View style={[styles.container, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 }]}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} hitSlop={8}>
            <Text style={styles.cancelBtn}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.title}>{title}</Text>
          <TouchableOpacity onPress={handleClear} hitSlop={8}>
            <Text style={styles.clearBtn}>Clear</Text>
          </TouchableOpacity>
        </View>

        {/* Selected range summary */}
        <View style={styles.summary}>
          <Pressable
            style={[styles.summaryBox, picking === 'start' && styles.summaryBoxActive]}
            onPress={() => setPicking('start')}
          >
            <Text style={styles.summaryLabel}>{startLabel}</Text>
            <Text style={[styles.summaryDate, !localStart && styles.summaryPlaceholder]}>
              {formatDisplay(localStart)}
            </Text>
          </Pressable>

          <Ionicons name="arrow-forward" size={16} color="#a3a3a3" />

          <Pressable
            style={[styles.summaryBox, picking === 'end' && styles.summaryBoxActive]}
            onPress={() => { if (localStart) setPicking('end'); }}
          >
            <Text style={styles.summaryLabel}>{endLabel}</Text>
            <Text style={[styles.summaryDate, !localEnd && styles.summaryPlaceholder]}>
              {formatDisplay(localEnd)}
            </Text>
          </Pressable>
        </View>

        <Text style={styles.instruction}>
          {picking === 'start' ? 'Tap a start date' : 'Tap an end date'}
        </Text>

        {/* Calendar */}
        <Calendar
          markingType="period"
          markedDates={markedDates}
          onDayPress={handleDayPress}
          minDate={allowPastDates ? undefined : today}
          theme={{
            calendarBackground: '#fff',
            textSectionTitleColor: '#737373',
            selectedDayBackgroundColor: '#D85A30',
            selectedDayTextColor: '#fff',
            todayTextColor: '#D85A30',
            dayTextColor: '#262626',
            textDisabledColor: '#d4d4d4',
            arrowColor: '#D85A30',
            monthTextColor: '#262626',
            textDayFontWeight: '500',
            textMonthFontWeight: '600',
            textDayHeaderFontWeight: '500',
          }}
          style={styles.calendar}
        />

        {/* Confirm */}
        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.confirmBtn, !localStart && styles.confirmBtnDisabled]}
            onPress={handleConfirm}
            disabled={!localStart}
            activeOpacity={0.8}
          >
            <Text style={styles.confirmText}>{confirmLabel}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  cancelBtn: { fontSize: 16, color: '#737373' },
  clearBtn: { fontSize: 16, color: '#D85A30' },
  title: { fontSize: 17, fontWeight: '600', color: '#262626' },

  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 20,
    marginBottom: 8,
  },
  summaryBox: {
    flex: 1, padding: 12,
    borderRadius: 12, borderWidth: 1.5,
    borderColor: '#e5e5e5', backgroundColor: '#fafafa',
  },
  summaryBoxActive: { borderColor: '#D85A30', backgroundColor: '#fff5f2' },
  summaryLabel: { fontSize: 11, color: '#737373', fontWeight: '500', marginBottom: 2 },
  summaryDate: { fontSize: 14, fontWeight: '600', color: '#262626' },
  summaryPlaceholder: { color: '#a3a3a3', fontWeight: '400' },

  instruction: {
    textAlign: 'center',
    fontSize: 13,
    color: '#a3a3a3',
    marginBottom: 8,
  },

  calendar: { marginHorizontal: 8 },

  footer: { paddingHorizontal: 20, paddingTop: 16 },
  confirmBtn: {
    backgroundColor: '#D85A30',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  confirmBtnDisabled: { backgroundColor: '#e5e5e5' },
  confirmText: { fontSize: 16, fontWeight: '600', color: '#fff' },
});
