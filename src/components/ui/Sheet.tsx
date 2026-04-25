import React from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { T } from '@/theme';

/**
 * <Sheet> — bottom-sheet modal wrapper.
 *
 * The "Add poll", "Add block", "Add expense", "Mark as booked", "Edit
 * lodging", and similar bottom-pulled sheets were all hand-rolled with
 * raw <Modal> + <Pressable> overlay + custom backdrop + manual padding.
 * This component centralizes that pattern so every sheet in the app
 * has the same: backdrop tint, drag-handle, rounded top corners,
 * keyboard avoidance, scrollable content area, optional header.
 *
 * Usage:
 *   <Sheet visible={open} onClose={() => setOpen(false)} title="Add expense">
 *     <YourFormFields />
 *     <Sheet.Actions>
 *       <Button variant="secondary" onPress={onClose} fullWidth>Cancel</Button>
 *       <Button variant="primary" onPress={onSave} fullWidth>Save</Button>
 *     </Sheet.Actions>
 *   </Sheet>
 *
 * Wraps content in a ScrollView by default — pass `scrollable={false}`
 * if you need to manage scroll yourself (e.g. nested FlatList).
 */
interface SheetProps {
  visible: boolean;
  onClose: () => void;
  /** Optional title rendered in the sheet header (left-aligned). */
  title?: string;
  /** Optional subtitle below the title (e.g. "Mon, Apr 6"). */
  subtitle?: string;
  /** Wrap children in a ScrollView. Default true. */
  scrollable?: boolean;
  /** Children get the safe inner padding. */
  children: React.ReactNode;
}

export function Sheet({
  visible,
  onClose,
  title,
  subtitle,
  scrollable = true,
  children,
}: SheetProps) {
  const insets = useSafeAreaInsets();

  const Body = scrollable ? ScrollView : View;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable
        style={{ flex: 1, backgroundColor: 'rgba(20, 25, 22, 0.42)', justifyContent: 'flex-end' }}
        onPress={onClose}
      >
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          {/* Inner Pressable swallows taps so they don't dismiss the sheet */}
          <Pressable
            onPress={() => { /* swallow */ }}
            style={{
              backgroundColor: T.card,
              borderTopLeftRadius: 28,
              borderTopRightRadius: 28,
              paddingBottom: insets.bottom + 12,
              maxHeight: '90%',
            }}
          >
            {/* Drag handle */}
            <View style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 4 }}>
              <View
                style={{
                  width: 40,
                  height: 4,
                  borderRadius: 2,
                  backgroundColor: T.line,
                }}
              />
            </View>

            {/* Optional header */}
            {title || subtitle ? (
              <View style={{ paddingHorizontal: 24, paddingTop: 14, paddingBottom: 8 }}>
                {title ? (
                  <Text style={{ fontSize: 22, fontWeight: '700', color: T.ink }}>
                    {title}
                  </Text>
                ) : null}
                {subtitle ? (
                  <Text style={{ fontSize: 14, color: T.muted, marginTop: 2 }}>
                    {subtitle}
                  </Text>
                ) : null}
              </View>
            ) : null}

            {/* Body */}
            <Body
              style={scrollable ? { maxHeight: '100%' } : undefined}
              contentContainerStyle={
                scrollable
                  ? { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 24, gap: 14 }
                  : undefined
              }
            >
              {children}
            </Body>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

/**
 * Sticky-bottom action row for sheet CTAs. Use as the last child of <Sheet>.
 * Renders horizontally with even spacing — typically 1 secondary + 1 primary.
 */
function Actions({ children }: { children: React.ReactNode }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        gap: 10,
        paddingHorizontal: 24,
        paddingTop: 8,
        paddingBottom: 4,
      }}
    >
      {children}
    </View>
  );
}

Sheet.Actions = Actions;
