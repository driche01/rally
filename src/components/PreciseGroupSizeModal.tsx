import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  InputAccessoryView,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';

const INPUT_ACCESSORY_ID = 'precise-group-size-input';
const DISMISS_THRESHOLD_Y = 80;
const DISMISS_THRESHOLD_VY = 0.5;

interface Props {
  visible: boolean;
  /** Current precise value (or null if not set). Pre-fills the input. */
  current: number | null;
  onSave: (value: number | null) => void;
  onClose: () => void;
}

/**
 * A small modal that lets the planner type an exact group head-count.
 * Submitting an empty field clears the precise value (falls back to bucket).
 */
export function PreciseGroupSizeModal({ visible, current, onSave, onClose }: Props) {
  const [raw, setRaw] = useState('');
  const inputRef = useRef<TextInput>(null);
  const translateY = useRef(new Animated.Value(0)).current;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, { dy }) => dy > 5,
      onPanResponderMove: (_, { dy }) => {
        if (dy > 0) translateY.setValue(dy);
      },
      onPanResponderRelease: (_, { dy, vy }) => {
        if (dy > DISMISS_THRESHOLD_Y || vy > DISMISS_THRESHOLD_VY) {
          Animated.timing(translateY, {
            toValue: 600,
            duration: 200,
            useNativeDriver: true,
          }).start(() => {
            translateY.setValue(0);
            onClose();
          });
        } else {
          Animated.spring(translateY, {
            toValue: 0,
            useNativeDriver: true,
          }).start();
        }
      },
    })
  ).current;

  // Pre-fill with the current value each time the modal opens
  useEffect(() => {
    if (visible) {
      translateY.setValue(0);
      setRaw(current != null ? String(current) : '');
      // Delay focus slightly so the modal animation finishes first
      const t = setTimeout(() => inputRef.current?.focus(), 200);
      return () => clearTimeout(t);
    }
  }, [visible, current]);

  function handleSave() {
    const trimmed = raw.trim();
    if (trimmed === '') {
      onSave(null); // clear precise value
      return;
    }
    const n = parseInt(trimmed, 10);
    if (!Number.isFinite(n) || n < 1 || n > 999) return;
    onSave(n);
  }

  const isValid = raw.trim() === '' || (
    Number.isFinite(parseInt(raw.trim(), 10)) &&
    parseInt(raw.trim(), 10) >= 1 &&
    parseInt(raw.trim(), 10) <= 999
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      {/* Scrim */}
      <Pressable
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}
        onPress={onClose}
      >
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <Animated.View style={{ transform: [{ translateY }], backgroundColor: 'white', borderTopLeftRadius: 24, borderTopRightRadius: 24 }}>
            {/* Drag handle */}
            <View {...panResponder.panHandlers} style={{ alignItems: 'center', paddingTop: 12, paddingBottom: 4 }}>
              <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: '#E5E5E5' }} />
            </View>

            {/* Sheet content — stop presses from bubbling to the scrim */}
            <Pressable onPress={() => {}} style={{ padding: 24, paddingTop: 12, gap: 16 }}>
              <Text style={{ fontSize: 17, fontWeight: '600', color: '#1C1C1C' }}>
                Exact group size
              </Text>
              <Text style={{ fontSize: 14, color: '#737373', marginTop: -8 }}>
                Enter the exact number of people in your group.
                Leave blank to use the rough range.
              </Text>

              <TextInput
                ref={inputRef}
                value={raw}
                onChangeText={(t) => {
                  // Only allow digits, max 3 chars
                  const digits = t.replace(/[^0-9]/g, '').slice(0, 3);
                  setRaw(digits);
                }}
                placeholder="e.g. 14"
                placeholderTextColor="#A3A3A3"
                keyboardType="number-pad"
                inputAccessoryViewID={Platform.OS === 'ios' ? INPUT_ACCESSORY_ID : undefined}
                onSubmitEditing={handleSave}
                style={{
                  borderWidth: 1.5,
                  borderColor: isValid ? '#E5E5E5' : '#EF4444',
                  borderRadius: 14,
                  paddingHorizontal: 16,
                  paddingVertical: 14,
                  fontSize: 20,
                  fontWeight: '600',
                  color: '#1C1C1C',
                  backgroundColor: '#FAFAFA',
                }}
              />

              {!isValid ? (
                <Text style={{ fontSize: 12, color: '#EF4444', marginTop: -8 }}>
                  Enter a number between 1 and 999.
                </Text>
              ) : null}

              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Pressable
                  onPress={onClose}
                  style={{
                    flex: 1,
                    paddingVertical: 14,
                    borderRadius: 14,
                    borderWidth: 1.5,
                    borderColor: '#E5E5E5',
                    alignItems: 'center',
                  }}
                >
                  <Text style={{ fontSize: 15, fontWeight: '600', color: '#525252' }}>Cancel</Text>
                </Pressable>

                <Pressable
                  onPress={isValid ? handleSave : undefined}
                  style={{
                    flex: 1,
                    paddingVertical: 14,
                    borderRadius: 14,
                    backgroundColor: isValid ? '#D85A30' : '#FCA99F',
                    alignItems: 'center',
                  }}
                >
                  <Text style={{ fontSize: 15, fontWeight: '600', color: 'white' }}>
                    {raw.trim() === '' ? 'Use range' : 'Save'}
                  </Text>
                </Pressable>
              </View>
            </Pressable>
          </Animated.View>
        </KeyboardAvoidingView>
      </Pressable>
      {Platform.OS === 'ios' && (
        <InputAccessoryView nativeID={INPUT_ACCESSORY_ID} />
      )}
    </Modal>
  );
}
