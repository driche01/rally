import { useState } from 'react';
import {
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Calendar } from 'react-native-calendars';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface Props {
  visible: boolean;
  value: string | null;
  onConfirm: (date: string | null) => void;
  onClose: () => void;
  /** Modal header title. */
  title?: string;
  /** Confirm button text. */
  confirmLabel?: string;
  /** Earliest selectable date (ISO 'YYYY-MM-DD'). Defaults to today. */
  minDate?: string;
}

function formatDisplay(date: string | null): string {
  if (!date) return 'Select a date';
  const [y, m, d] = date.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[parseInt(m, 10) - 1]} ${parseInt(d, 10)}, ${y}`;
}

export function SingleDatePicker({
  visible,
  value,
  onConfirm,
  onClose,
  title = 'Pick a date',
  confirmLabel = 'Confirm',
  minDate,
}: Props) {
  const insets = useSafeAreaInsets();
  const [local, setLocal] = useState<string | null>(value);

  const handleOpen = () => setLocal(value);

  function handleConfirm() {
    onConfirm(local);
    onClose();
  }

  function handleClear() {
    setLocal(null);
  }

  const today = new Date().toISOString().slice(0, 10);
  const effectiveMin = minDate ?? today;
  const marked = local
    ? { [local]: { selected: true, selectedColor: '#0F3F2E', selectedTextColor: '#FFFFFF' } }
    : {};

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
      onShow={handleOpen}
    >
      <View style={[styles.container, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} hitSlop={8}>
            <Text style={styles.cancelBtn}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.title}>{title}</Text>
          <TouchableOpacity onPress={handleClear} hitSlop={8}>
            <Text style={styles.clearBtn}>Clear</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.summary}>
          <Text style={styles.summaryLabel}>Selected</Text>
          <Text style={[styles.summaryDate, !local && styles.summaryPlaceholder]}>
            {formatDisplay(local)}
          </Text>
        </View>

        <Calendar
          markedDates={marked}
          onDayPress={(day: { dateString: string }) => setLocal(day.dateString)}
          minDate={effectiveMin}
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
            style={[styles.confirmBtn, !local && styles.confirmBtnDisabled]}
            onPress={handleConfirm}
            disabled={!local}
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
  container: { flex: 1, backgroundColor: '#FFFCF6' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  cancelBtn: { fontSize: 16, color: '#5F685F' },
  clearBtn:  { fontSize: 16, color: '#0F3F2E' },
  title:     { fontSize: 17, fontWeight: '600', color: '#163026' },

  summary: {
    marginHorizontal: 20,
    marginBottom: 12,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#0F3F2E',
    backgroundColor: '#DFE8D2',
  },
  summaryLabel: { fontSize: 11, color: '#5F685F', fontWeight: '500', marginBottom: 2 },
  summaryDate:  { fontSize: 14, fontWeight: '600', color: '#163026' },
  summaryPlaceholder: { color: '#9DA8A0', fontWeight: '400' },

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
