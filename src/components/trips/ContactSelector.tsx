/**
 * ContactSelector — pick trip participants from native contacts or add manually.
 *
 * Two entry paths:
 *   1. "Choose from contacts" — opens the iOS/Android native contacts list.
 *      Multi-select. The picked contacts arrive with name + phone(s); we
 *      keep the first non-empty phone and present a one-tap edit if the
 *      planner wants to fix the name.
 *   2. "Add by phone" — manual entry sheet for someone not in contacts
 *      (or for web, where no Contacts API exists).
 *
 * The list is the source of truth — there's no separate "selected" state.
 * Tap any row to edit its name; swipe-left or tap the X to remove.
 *
 * Phone numbers are stored as the raw string the user/contacts provided.
 * Normalization (E.164) happens server-side at trip creation. Visual
 * formatting (US-style "(555) 123-4567") happens here for readability.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const IS_NATIVE = Platform.OS === 'ios' || Platform.OS === 'android';

// Static, conditional import. Web has its own stub that lacks the native
// methods — guard at call sites via IS_NATIVE before invoking anything.
// Static import resolves more reliably than `await import()` under Metro.
type ContactsModule = typeof import('expo-contacts');
let Contacts: ContactsModule | null = null;
if (IS_NATIVE) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    Contacts = require('expo-contacts');
  } catch {
    Contacts = null;
  }
}

interface PickerContact {
  id: string;
  name: string;
  phone: string;
  email: string | null;
}

export interface SelectedContact {
  /** Stable id — contactId from the OS, or a generated 'manual_<n>' string. */
  id: string;
  name: string;
  phone: string;
  email?: string | null;
}

interface Props {
  value: SelectedContact[];
  onChange: (next: SelectedContact[]) => void;
  /** When true, a planner-only hint is appended ("Includes you (Name) automatically"). */
  plannerLabel?: string | null;
  /** Inline error message to render below the section header. */
  error?: string;
}

function formatPhoneForDisplay(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6)}`;
  if (digits.length === 11 && digits.startsWith('1')) {
    return `(${digits.slice(1,4)}) ${digits.slice(4,7)}-${digits.slice(7)}`;
  }
  return raw;
}

/**
 * Fetch all contacts that have at least one phone number. Returns them
 * sorted by display name. Permission check is the caller's responsibility.
 *
 * `expo-contacts.presentContactPickerAsync` exists but only returns a
 * single contact at a time — we need multi-select, so we render our own
 * list-with-checkboxes UI on top of getContactsAsync.
 */
async function fetchAllPhoneContacts(): Promise<PickerContact[]> {
  if (!Contacts) return [];
  const { data } = await Contacts.getContactsAsync({
    fields: [
      Contacts.Fields.Name,
      Contacts.Fields.FirstName,
      Contacts.Fields.LastName,
      Contacts.Fields.PhoneNumbers,
      Contacts.Fields.Emails,
    ],
    sort: Contacts.SortTypes.FirstName,
  });
  const out: PickerContact[] = [];
  for (const c of data ?? []) {
    const phone = c.phoneNumbers?.[0]?.number;
    if (!phone) continue;
    const name = (c.name ?? `${c.firstName ?? ''} ${c.lastName ?? ''}`).trim() || phone;
    out.push({
      id: c.id ?? `c_${out.length}`,
      name,
      phone,
      email: c.emails?.[0]?.email ?? null,
    });
  }
  return out;
}

export function ContactSelector({ value, onChange, plannerLabel, error }: Props) {
  const [manualOpen, setManualOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<SelectedContact | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  async function handleOpenContactsPicker() {
    if (!IS_NATIVE || !Contacts) {
      Alert.alert(
        "Can't open contacts here",
        "Native contacts aren't available in this build. Use 'Add by phone' instead, or open Rally on your phone.",
      );
      return;
    }
    const { status } = await Contacts.requestPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(
        'Contacts permission needed',
        'Rally needs access to your contacts to add people without typing every phone number. Enable in Settings → Rally → Contacts.',
      );
      return;
    }
    setPickerOpen(true);
  }

  function handlePickerDone(picked: PickerContact[]) {
    setPickerOpen(false);
    if (picked.length === 0) return;
    const existing = new Set(value.map((v) => v.phone));
    const novel = picked.filter((p) => !existing.has(p.phone)).map((p) => ({
      id: p.id,
      name: p.name,
      phone: p.phone,
      email: p.email,
    } satisfies SelectedContact));
    if (novel.length === 0) {
      Alert.alert('Already added', "Those contacts are already on the list.");
      return;
    }
    onChange([...value, ...novel]);
  }

  function handleRemove(id: string) {
    onChange(value.filter((v) => v.id !== id));
  }

  function handleManualSubmit(c: SelectedContact) {
    if (editTarget) {
      onChange(value.map((v) => v.id === editTarget.id ? { ...c, id: editTarget.id } : v));
      setEditTarget(null);
    } else {
      onChange([...value, c]);
    }
    setManualOpen(false);
  }

  const total = value.length + (plannerLabel ? 1 : 0);

  return (
    <View style={styles.wrap}>
      <View style={styles.headerRow}>
        <Text style={styles.label}>Who's invited?</Text>
        {value.length > 0 ? (
          <Text style={styles.count}>{total} {total === 1 ? 'person' : 'people'}</Text>
        ) : null}
      </View>
      <Text style={styles.hint}>
        Rally will text everyone here when you create the trip.
      </Text>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {/* Action row */}
      <View style={styles.actions}>
        {IS_NATIVE ? (
          <Pressable onPress={handleOpenContactsPicker} style={[styles.actionBtn, styles.actionBtnPrimary]} accessibilityRole="button">
            <Ionicons name="people-outline" size={16} color="#0F3F2E" />
            <Text style={styles.actionBtnPrimaryText}>Choose from contacts</Text>
          </Pressable>
        ) : null}
        <Pressable onPress={() => { setEditTarget(null); setManualOpen(true); }} style={[styles.actionBtn, styles.actionBtnSecondary]} accessibilityRole="button">
          <Ionicons name="add-outline" size={16} color="#0F3F2E" />
          <Text style={styles.actionBtnSecondaryText}>Add by phone</Text>
        </Pressable>
      </View>

      {/* Selected list */}
      {value.length > 0 ? (
        <View style={styles.list}>
          {plannerLabel ? (
            <View style={[styles.row, styles.rowPlanner]}>
              <View style={styles.avatar}>
                <Ionicons name="ribbon" size={14} color="#D97706" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{plannerLabel}</Text>
                <Text style={styles.subline}>You · planner</Text>
              </View>
            </View>
          ) : null}
          {value.map((c) => (
            <View key={c.id} style={styles.row}>
              <Pressable
                style={{ flex: 1, flexDirection: 'row', gap: 10, alignItems: 'center' }}
                onPress={() => { setEditTarget(c); setManualOpen(true); }}
                accessibilityRole="button"
                accessibilityLabel={`Edit ${c.name}`}
              >
                <View style={styles.avatar}>
                  <Text style={styles.avatarInitial}>{(c.name[0] ?? '?').toUpperCase()}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name} numberOfLines={1}>{c.name}</Text>
                  <Text style={styles.subline}>{formatPhoneForDisplay(c.phone)}</Text>
                </View>
              </Pressable>
              <Pressable
                onPress={() => handleRemove(c.id)}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${c.name}`}
              >
                <Ionicons name="close-circle" size={20} color="#A0A0A0" />
              </Pressable>
            </View>
          ))}
        </View>
      ) : (
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>
            No one added yet. Pick from your contacts or add a phone number to get started.
          </Text>
        </View>
      )}

      {/* Native contacts multi-select */}
      <NativeContactPickerModal
        visible={pickerOpen}
        excludePhones={value.map((v) => v.phone)}
        onDone={handlePickerDone}
        onClose={() => setPickerOpen(false)}
      />

      {/* Manual add / edit modal */}
      <ManualEntryModal
        visible={manualOpen}
        target={editTarget}
        onSubmit={handleManualSubmit}
        onClose={() => { setManualOpen(false); setEditTarget(null); }}
      />
    </View>
  );
}

// ─── Native multi-select contacts modal ─────────────────────────────────────

interface PickerProps {
  visible: boolean;
  excludePhones: string[];
  onDone: (picked: PickerContact[]) => void;
  onClose: () => void;
}

function NativeContactPickerModal({ visible, excludePhones, onDone, onClose }: PickerProps) {
  const insets = useSafeAreaInsets();
  const [contacts, setContacts] = useState<PickerContact[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const excludeSet = useMemo(() => new Set(excludePhones), [excludePhones]);

  useEffect(() => {
    if (!visible) return;
    setSelectedIds(new Set());
    setSearch('');
    if (contacts !== null) return; // already cached this session
    setLoading(true);
    fetchAllPhoneContacts()
      .then((list) => setContacts(list))
      .catch(() => setContacts([]))
      .finally(() => setLoading(false));
  }, [visible]);

  const filtered = useMemo(() => {
    if (!contacts) return [];
    const q = search.trim().toLowerCase();
    return contacts.filter((c) => {
      if (excludeSet.has(c.phone)) return false;
      if (!q) return true;
      return c.name.toLowerCase().includes(q) || c.phone.includes(q);
    });
  }, [contacts, search, excludeSet]);

  function toggle(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function handleDone() {
    if (!contacts) return;
    const picked = contacts.filter((c) => selectedIds.has(c.id));
    onDone(picked);
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#FFFCF6', paddingTop: insets.top > 0 ? 0 : 12 }}>
        <View style={[styles.modalHeader, { paddingTop: 16 }]}>
          <Pressable onPress={onClose} hitSlop={10}>
            <Text style={styles.modalCancel}>Cancel</Text>
          </Pressable>
          <Text style={styles.modalTitle}>Choose contacts</Text>
          <Pressable onPress={handleDone} hitSlop={10} disabled={selectedIds.size === 0}>
            <Text style={[styles.modalSave, selectedIds.size === 0 && { color: '#A0C0B2' }]}>
              Done{selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}
            </Text>
          </Pressable>
        </View>

        <View style={{ paddingHorizontal: 20, paddingVertical: 12 }}>
          <View style={styles.searchBar}>
            <Ionicons name="search-outline" size={16} color="#888" />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search name or phone…"
              placeholderTextColor="#a3a3a3"
              style={styles.searchInput}
              autoCorrect={false}
              autoCapitalize="none"
            />
          </View>
        </View>

        {loading ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator color="#0F3F2E" />
            <Text style={{ marginTop: 12, color: '#888' }}>Loading contacts…</Text>
          </View>
        ) : filtered.length === 0 ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30 }}>
            <Text style={{ fontSize: 14, color: '#5F685F', textAlign: 'center' }}>
              {contacts && contacts.length === 0
                ? "No contacts with phone numbers found on this device."
                : search
                  ? `No matches for "${search}"`
                  : 'Everyone with a phone number is already on the list.'}
            </Text>
          </View>
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={(c) => c.id}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => {
              const isSel = selectedIds.has(item.id);
              return (
                <Pressable
                  onPress={() => toggle(item.id)}
                  style={[styles.pickerRow, isSel && styles.pickerRowSelected]}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: isSel }}
                >
                  <View style={[styles.checkbox, isSel && styles.checkboxOn]}>
                    {isSel ? <Ionicons name="checkmark" size={14} color="white" /> : null}
                  </View>
                  <View style={styles.avatar}>
                    <Text style={styles.avatarInitial}>{(item.name[0] ?? '?').toUpperCase()}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
                    <Text style={styles.subline}>{formatPhoneForDisplay(item.phone)}</Text>
                  </View>
                </Pressable>
              );
            }}
            contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          />
        )}
      </View>
    </Modal>
  );
}

interface ManualProps {
  visible: boolean;
  target: SelectedContact | null;
  onSubmit: (c: SelectedContact) => void;
  onClose: () => void;
}

/**
 * Split a full name into [first, last]. First token is first name, rest
 * is concatenated as last name. Trims and tolerates multiple spaces.
 *   "David Riche"        → ["David", "Riche"]
 *   "Mary Jane Watson"   → ["Mary", "Jane Watson"]
 *   "Madonna"            → ["Madonna", ""]
 *   ""                   → ["", ""]
 */
function splitName(full: string): [string, string] {
  const parts = full.trim().split(/\s+/);
  if (parts.length === 0 || parts[0] === '') return ['', ''];
  return [parts[0], parts.slice(1).join(' ')];
}

function ManualEntryModal({ visible, target, onSubmit, onClose }: ManualProps) {
  const insetTop = Platform.OS === 'ios' ? 24 : 16;
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [err, setErr] = useState<string | null>(null);

  React.useEffect(() => {
    if (visible) {
      const [f, l] = splitName(target?.name ?? '');
      setFirstName(f);
      setLastName(l);
      setPhone(target?.phone ?? '');
      setErr(null);
    }
  }, [visible, target]);

  function handleSave() {
    const cleanFirst = firstName.trim();
    const cleanLast = lastName.trim();
    const cleanPhone = phone.trim();
    if (!cleanFirst) { setErr('Add a first name'); return; }
    if (cleanPhone.replace(/\D/g, '').length < 10) { setErr('Add a 10-digit phone'); return; }
    const composedName = cleanLast ? `${cleanFirst} ${cleanLast}` : cleanFirst;
    onSubmit({
      id: target?.id ?? `manual_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: composedName,
      phone: cleanPhone,
      email: target?.email ?? null,
    });
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1, backgroundColor: '#FFFCF6' }}
      >
        <View style={[styles.modalHeader, { paddingTop: insetTop + 8 }]}>
          <Pressable onPress={onClose} hitSlop={10}>
            <Text style={styles.modalCancel}>Cancel</Text>
          </Pressable>
          <Text style={styles.modalTitle}>{target ? 'Edit person' : 'Add person'}</Text>
          <Pressable onPress={handleSave} hitSlop={10}>
            <Text style={styles.modalSave}>Save</Text>
          </Pressable>
        </View>

        <View style={styles.modalBody}>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <View style={[styles.modalField, { flex: 1 }]}>
              <Text style={styles.modalLabel}>First name</Text>
              <TextInput
                value={firstName}
                onChangeText={(t) => { setFirstName(t); setErr(null); }}
                placeholder="Sarah"
                placeholderTextColor="#a3a3a3"
                style={styles.modalInput}
                autoFocus
                autoCapitalize="words"
                maxLength={40}
                returnKeyType="next"
              />
            </View>
            <View style={[styles.modalField, { flex: 1 }]}>
              <Text style={styles.modalLabel}>Last name</Text>
              <TextInput
                value={lastName}
                onChangeText={(t) => { setLastName(t); setErr(null); }}
                placeholder="Optional"
                placeholderTextColor="#a3a3a3"
                style={styles.modalInput}
                autoCapitalize="words"
                maxLength={40}
                returnKeyType="next"
              />
            </View>
          </View>
          <View style={styles.modalField}>
            <Text style={styles.modalLabel}>Phone</Text>
            <TextInput
              value={phone}
              onChangeText={(t) => { setPhone(t); setErr(null); }}
              placeholder="e.g. (555) 123-4567"
              placeholderTextColor="#a3a3a3"
              style={styles.modalInput}
              keyboardType="phone-pad"
              maxLength={20}
            />
          </View>
          {err ? <Text style={styles.modalErr}>{err}</Text> : null}
          <Text style={styles.modalHint}>
            US numbers only for now. Rally will normalize the format before sending.
          </Text>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { fontSize: 14, fontWeight: '500', color: '#404040' },
  count: { fontSize: 12, fontWeight: '600', color: '#5F685F' },
  hint: { fontSize: 13, color: '#737373', marginTop: -2 },
  errorText: { fontSize: 13, color: '#EF4444', marginTop: 2 },

  actions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 4 },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1.5,
  },
  actionBtnPrimary: { backgroundColor: '#DFE8D2', borderColor: '#0F3F2E' },
  actionBtnPrimaryText: { fontSize: 13, fontWeight: '700', color: '#0F3F2E' },
  actionBtnSecondary: { backgroundColor: '#FFFCF6', borderColor: '#D9CCB6' },
  actionBtnSecondaryText: { fontSize: 13, fontWeight: '600', color: '#0F3F2E' },

  list: {
    backgroundColor: 'white',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#EBEBEB',
    overflow: 'hidden',
    marginTop: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F0F0F0',
  },
  rowPlanner: { backgroundColor: '#FAF5EA' },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#EFE3D0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: { fontSize: 13, fontWeight: '700', color: '#0F3F2E' },
  name: { fontSize: 14, fontWeight: '600', color: '#163026' },
  subline: { fontSize: 12, color: '#737373', marginTop: 1 },

  emptyState: {
    backgroundColor: '#FAF5EA',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginTop: 6,
  },
  emptyText: { fontSize: 13, color: '#5F685F', lineHeight: 19, textAlign: 'center' },

  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#EFE3D0',
  },
  modalCancel: { fontSize: 16, color: '#5F685F' },
  modalTitle: { fontSize: 17, fontWeight: '700', color: '#163026' },
  modalSave: { fontSize: 16, fontWeight: '700', color: '#0F3F2E' },
  modalBody: { padding: 20, gap: 16 },
  modalField: { gap: 6 },
  modalLabel: { fontSize: 12, fontWeight: '600', color: '#5F685F', textTransform: 'uppercase', letterSpacing: 0.5 },
  modalInput: {
    backgroundColor: 'white',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E5E5',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: '#163026',
  },
  modalErr: { fontSize: 13, color: '#9A2A2A' },
  modalHint: { fontSize: 12, color: '#888' },

  // Picker modal
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#F3F1EC',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: '#163026',
    padding: 0,
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#EFE3D0',
  },
  pickerRowSelected: { backgroundColor: '#F0F7E8' },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: '#A0C0B2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: '#0F3F2E', borderColor: '#0F3F2E' },
});
