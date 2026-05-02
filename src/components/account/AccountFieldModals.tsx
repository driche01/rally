/**
 * Account-field edit modals — Name / Email / Phone / Password.
 *
 * Each modal mounts as a slide-up sheet with its own input chrome
 * and Save/Cancel actions. They differ in the auth challenges:
 *
 *   • Name      — write-through, no challenge.
 *   • Email     — `supabase.auth.updateUser({ email })` sends a
 *                  verification link to the NEW address. The change
 *                  isn't applied until the user clicks the link;
 *                  modal closes with a "Check your inbox" alert.
 *   • Phone     — `supabase.auth.updateUser({ phone })` sends an OTP
 *                  to the NEW phone. Modal flips to a 6-digit input,
 *                  verifyOtp with type='phone_change' commits.
 *   • Password  — modal asks for current + new + confirm. Verifies
 *                  current via signInWithPassword, then commits new
 *                  via updateUser({ password }).
 *
 * On success, each modal calls `onSaved()` so the parent screen can
 * refetch the profile or show feedback. All API errors surface as
 * inline red text inside the modal.
 */
import React, { useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '@/lib/supabase';
import { normalizePhone } from '@/lib/phone';

interface BaseProps {
  visible: boolean;
  onClose: () => void;
  onSaved: () => void;
}

// ─── Generic shell ───────────────────────────────────────────────────────────

function ModalShell({
  title,
  visible,
  onClose,
  onSave,
  saving,
  saveLabel = 'Save',
  saveDisabled = false,
  children,
}: {
  title: string;
  visible: boolean;
  onClose: () => void;
  onSave: () => void;
  saving: boolean;
  saveLabel?: string;
  saveDisabled?: boolean;
  children: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1, backgroundColor: '#FBF7EF' }}
      >
        <View style={[styles.header, { paddingTop: (Platform.OS === 'ios' ? 24 : 16) + 8 }]}>
          <Pressable onPress={onClose} hitSlop={10} disabled={saving}>
            <Text style={[styles.cancelBtn, saving && { color: '#A0C0B2' }]}>Cancel</Text>
          </Pressable>
          <Text style={styles.title}>{title}</Text>
          <Pressable onPress={onSave} hitSlop={10} disabled={saving || saveDisabled}>
            <Text style={[styles.saveBtn, (saving || saveDisabled) && { color: '#A0C0B2' }]}>
              {saving ? 'Saving…' : saveLabel}
            </Text>
          </Pressable>
        </View>
        <ScrollView
          contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 24, gap: 16 }}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <Text style={styles.fieldLabel}>{children}</Text>;
}

function ErrText({ children }: { children: React.ReactNode }) {
  return <Text style={styles.errText}>{children}</Text>;
}

// ─── Name ────────────────────────────────────────────────────────────────────

export function EditNameModal({
  visible,
  onClose,
  onSaved,
  initialName,
}: BaseProps & { initialName: string | null }) {
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      const parts = (initialName ?? '').trim().split(/\s+/);
      setFirst(parts[0] ?? '');
      setLast(parts.slice(1).join(' '));
      setErr(null);
    }
  }, [visible, initialName]);

  async function handleSave() {
    const cleanFirst = first.trim();
    const cleanLast = last.trim();
    if (!cleanFirst) { setErr('First name is required'); return; }
    setSaving(true);
    setErr(null);
    const composed = cleanLast ? `${cleanFirst} ${cleanLast}` : cleanFirst;
    try {
      const { error: authErr } = await supabase.auth.updateUser({
        data: { name: composed, first_name: cleanFirst, last_name: cleanLast || null },
      });
      if (authErr) throw authErr;
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase
          .from('profiles')
          .update({ name: cleanFirst, last_name: cleanLast || null })
          .eq('id', user.id);
        // Propagate the new full name to users.display_name and every
        // trip_session_participants row tied to this account so the
        // planner row on existing trips re-renders with the right
        // name. Best-effort — a failure here just means the SMS-side
        // identity stays stale until the next session-create.
        await supabase.rpc('app_sync_my_display_name');
      }
      onSaved();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not update name.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell title="Edit name" visible={visible} onClose={onClose} onSave={handleSave} saving={saving}>
      <View>
        <FieldLabel>First name</FieldLabel>
        <TextInput
          value={first}
          onChangeText={(t) => { setFirst(t); setErr(null); }}
          style={styles.input}
          autoCapitalize="words"
          autoFocus
          maxLength={40}
          returnKeyType="next"
        />
      </View>
      <View>
        <FieldLabel>Last name</FieldLabel>
        <TextInput
          value={last}
          onChangeText={(t) => { setLast(t); setErr(null); }}
          style={styles.input}
          autoCapitalize="words"
          maxLength={40}
          placeholder="Optional"
          placeholderTextColor="#a3a3a3"
        />
      </View>
      {err ? <ErrText>{err}</ErrText> : null}
    </ModalShell>
  );
}

// ─── Email ───────────────────────────────────────────────────────────────────

export function EditEmailModal({
  visible,
  onClose,
  onSaved,
  initialEmail,
}: BaseProps & { initialEmail: string | null }) {
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setEmail(initialEmail ?? '');
      setErr(null);
    }
  }, [visible, initialEmail]);

  async function handleSave() {
    const cleanEmail = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(cleanEmail)) { setErr('Enter a valid email'); return; }
    if (cleanEmail === (initialEmail ?? '').toLowerCase()) { onClose(); return; }
    setSaving(true);
    setErr(null);
    try {
      const { error } = await supabase.auth.updateUser({ email: cleanEmail });
      if (error) throw error;
      Alert.alert(
        'Check your inbox',
        `We sent a confirmation link to ${cleanEmail}. Tap it to finish updating your email.`,
      );
      onSaved();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not update email.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell title="Edit email" visible={visible} onClose={onClose} onSave={handleSave} saving={saving}>
      <View>
        <FieldLabel>New email</FieldLabel>
        <TextInput
          value={email}
          onChangeText={(t) => { setEmail(t); setErr(null); }}
          style={styles.input}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
          maxLength={120}
        />
      </View>
      <Text style={styles.helpText}>
        We'll send a confirmation link to your new email. The change takes effect once you click it.
      </Text>
      {err ? <ErrText>{err}</ErrText> : null}
    </ModalShell>
  );
}

// ─── Phone ───────────────────────────────────────────────────────────────────

export function EditPhoneModal({
  visible,
  onClose,
  onSaved,
  initialPhone,
}: BaseProps & { initialPhone: string | null }) {
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  // Two-step flow: 'enter' → 'verify'.
  const [step, setStep] = useState<'enter' | 'verify'>('enter');
  const [submittedPhone, setSubmittedPhone] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setPhone(initialPhone ?? '');
      setOtp('');
      setStep('enter');
      setSubmittedPhone('');
      setErr(null);
    }
  }, [visible, initialPhone]);

  async function handleSendOtp() {
    const normalized = normalizePhone(phone);
    if (!normalized) { setErr('Enter a valid US phone number'); return; }
    if (normalized === initialPhone) { onClose(); return; }
    setSaving(true);
    setErr(null);
    try {
      const { error } = await supabase.auth.updateUser({ phone: normalized });
      if (error) throw error;
      setSubmittedPhone(normalized);
      setStep('verify');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not send code.');
    } finally {
      setSaving(false);
    }
  }

  async function handleVerifyOtp() {
    if (otp.trim().length < 4) { setErr('Enter the code'); return; }
    setSaving(true);
    setErr(null);
    try {
      const { error } = await supabase.auth.verifyOtp({
        phone: submittedPhone,
        token: otp.trim(),
        type: 'phone_change',
      });
      if (error) throw error;
      // Mirror onto the Rally users / profiles row so the rest of the
      // app sees the updated phone immediately.
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase.from('profiles').update({ phone: submittedPhone }).eq('id', user.id);
      }
      onSaved();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Code rejected. Try again.');
    } finally {
      setSaving(false);
    }
  }

  if (step === 'enter') {
    return (
      <ModalShell title="Edit phone" visible={visible} onClose={onClose} onSave={handleSendOtp} saving={saving} saveLabel="Send code">
        <View>
          <FieldLabel>New phone</FieldLabel>
          <TextInput
            value={phone}
            onChangeText={(t) => { setPhone(t); setErr(null); }}
            style={styles.input}
            keyboardType="phone-pad"
            autoFocus
            maxLength={20}
            placeholder="(555) 123-4567"
            placeholderTextColor="#a3a3a3"
          />
        </View>
        <Text style={styles.helpText}>
          We'll text a 6-digit code to your new phone. Enter it on the next screen to confirm.
        </Text>
        {err ? <ErrText>{err}</ErrText> : null}
      </ModalShell>
    );
  }

  return (
    <ModalShell title="Verify phone" visible={visible} onClose={onClose} onSave={handleVerifyOtp} saving={saving} saveLabel="Verify">
      <Text style={styles.helpText}>
        Enter the 6-digit code we sent to {submittedPhone}.
      </Text>
      <View>
        <FieldLabel>Code</FieldLabel>
        <TextInput
          value={otp}
          onChangeText={(t) => { setOtp(t.replace(/[^0-9]/g, '')); setErr(null); }}
          style={styles.input}
          keyboardType="number-pad"
          autoFocus
          maxLength={6}
          textContentType="oneTimeCode"
        />
      </View>
      <Pressable onPress={() => { setStep('enter'); setErr(null); }} hitSlop={8}>
        <Text style={styles.linkBtn}>← Use a different phone</Text>
      </Pressable>
      {err ? <ErrText>{err}</ErrText> : null}
    </ModalShell>
  );
}

// ─── Password ────────────────────────────────────────────────────────────────

export function EditPasswordModal({
  visible,
  onClose,
  onSaved,
  email,
}: BaseProps & { email: string | null }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setCurrent('');
      setNext('');
      setConfirm('');
      setErr(null);
    }
  }, [visible]);

  async function handleSave() {
    if (!email) { setErr("Can't change password — no email on this account."); return; }
    if (current.length === 0) { setErr('Enter your current password'); return; }
    if (next.length < 8) { setErr('New password must be at least 8 characters'); return; }
    if (next !== confirm) { setErr("New passwords don't match"); return; }
    if (next === current) { setErr('New password must be different from the current one'); return; }
    setSaving(true);
    setErr(null);
    try {
      // Re-authenticate by signing in with current password. Supabase
      // will set a fresh session — same user, so no UX side effect.
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email, password: current,
      });
      if (signInErr) {
        setErr('Current password is incorrect');
        setSaving(false);
        return;
      }
      const { error: updateErr } = await supabase.auth.updateUser({ password: next });
      if (updateErr) throw updateErr;
      Alert.alert('Password updated', 'Your password has been changed.');
      onSaved();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not update password.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell title="Change password" visible={visible} onClose={onClose} onSave={handleSave} saving={saving}>
      <View>
        <FieldLabel>Current password</FieldLabel>
        <TextInput
          value={current}
          onChangeText={(t) => { setCurrent(t); setErr(null); }}
          style={styles.input}
          secureTextEntry
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          textContentType="password"
        />
      </View>
      <View>
        <FieldLabel>New password</FieldLabel>
        <TextInput
          value={next}
          onChangeText={(t) => { setNext(t); setErr(null); }}
          style={styles.input}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          textContentType="newPassword"
        />
      </View>
      <View>
        <FieldLabel>Confirm new password</FieldLabel>
        <TextInput
          value={confirm}
          onChangeText={(t) => { setConfirm(t); setErr(null); }}
          style={styles.input}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          textContentType="newPassword"
        />
      </View>
      {err ? <ErrText>{err}</ErrText> : null}
    </ModalShell>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#D9CCB6',
  },
  cancelBtn: { fontSize: 16, color: '#5F685F' },
  saveBtn: { fontSize: 16, fontWeight: '600', color: '#0F3F2E' },
  title: { fontSize: 17, fontWeight: '700', color: '#163026' },
  fieldLabel: {
    fontSize: 12,
    color: '#737373',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 6,
  },
  input: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#D9CCB6',
    backgroundColor: '#FFFCF6',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: '#163026',
  },
  helpText: { fontSize: 13, color: '#5F685F', lineHeight: 18 },
  errText: { fontSize: 13, color: '#9A2A2A' },
  linkBtn: { fontSize: 13, color: '#0F3F2E', fontWeight: '600' },
});
