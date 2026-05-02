/**
 * TextBlastComposerModal — sheet-presented composer for the "Text blast"
 * broadcast on a trip. Lifted out of the legacy Members-screen FAB so
 * the trip-hero "Text blast" pill can reuse the same flow.
 *
 * Self-contained: holds its own body state + mutation lifecycle, fires
 * a confirm-alert before sending. On success, fires `onSent({sent,failed})`
 * so the parent can render a transient toast; errors stay as Alert.alert.
 */
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useBroadcastToSession } from '@/hooks/useTripSession';

interface Props {
  visible: boolean;
  /** Trip-session id — required for the broadcast mutation. Modal
   *  no-ops when undefined (e.g. SMS session not yet provisioned). */
  sessionId: string | undefined;
  /** Active+attending head-count, drives the "to N people" copy. */
  recipientCount: number;
  onClose: () => void;
  /** Fired after a successful send. Parent shows a transient toast;
   *  errors stay as Alert.alert so they don't auto-dismiss. */
  onSent?: (result: { sent: number; failed: number }) => void;
}

export function TextBlastComposerModal({ visible, sessionId, recipientCount, onClose, onSent }: Props) {
  const [body, setBody] = useState('');
  const broadcast = useBroadcastToSession(sessionId);

  useEffect(() => {
    if (visible) setBody('');
  }, [visible]);

  function handleSend() {
    const trimmed = body.trim();
    if (!trimmed) return;
    Alert.alert(
      `Send to ${recipientCount} ${recipientCount === 1 ? 'person' : 'people'}?`,
      trimmed.length > 240 ? trimmed.slice(0, 240) + '…' : trimmed,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Send', onPress: () => doSend(trimmed) },
      ],
    );
  }

  async function doSend(trimmed: string) {
    const result = await broadcast.mutateAsync(trimmed);
    if (!result.ok) {
      Alert.alert(
        'Broadcast failed',
        result.reason === 'forbidden'
          ? 'Only the planner can broadcast.'
          : `Couldn't send: ${result.reason ?? 'unknown error'}`,
      );
      return;
    }
    onClose();
    onSent?.({ sent: result.sent ?? 0, failed: result.failed ?? 0 });
  }

  const sendDisabled = !body.trim() || broadcast.isPending;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1, backgroundColor: '#F5F4F0' }}
      >
        <View style={styles.modalHeader}>
          <Pressable onPress={onClose}>
            <Text style={styles.modalCancel}>Cancel</Text>
          </Pressable>
          <Text style={styles.modalTitle}>Text blast</Text>
          <Pressable onPress={handleSend} disabled={sendDisabled}>
            <Text style={[styles.modalAction, sendDisabled && { color: '#CCC' }]}>
              {broadcast.isPending ? 'Sending…' : 'Send'}
            </Text>
          </Pressable>
        </View>
        <View style={{ padding: 20, gap: 12, flex: 1 }}>
          <View style={styles.recipientRow}>
            <Ionicons name="megaphone-outline" size={14} color="#5F685F" />
            <Text style={styles.modalHint}>
              Texts {recipientCount} {recipientCount === 1 ? 'person' : 'people'} on their 1:1 thread with Rally.
            </Text>
          </View>
          <TextInput
            value={body}
            onChangeText={setBody}
            placeholder="Type your message…"
            multiline
            style={styles.input}
            maxLength={1000}
            autoFocus
          />
          <View style={styles.footerRow}>
            <Text style={styles.placeholderHint}>
              Use [Name], [Planner], [Destination], or [Trip] — each invitee gets their own values filled in.
            </Text>
            <Text style={styles.charCount}>{body.length} / 1000</Text>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 20, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: '#EEE', backgroundColor: 'white',
  },
  modalCancel: { fontSize: 16, color: '#0F3F2E' },
  modalTitle: { fontSize: 17, fontWeight: '600', color: '#163026' },
  modalAction: { fontSize: 16, fontWeight: '600', color: '#0F3F2E' },
  recipientRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  modalHint: { fontSize: 13, color: '#666' },
  input: {
    backgroundColor: 'white', borderRadius: 12, borderWidth: 1, borderColor: '#E5E5E5',
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, color: '#163026',
    minHeight: 160, textAlignVertical: 'top',
  },
  footerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  placeholderHint: { flex: 1, fontSize: 11, color: '#737373', lineHeight: 15 },
  charCount: { fontSize: 11, color: '#888' },
});
