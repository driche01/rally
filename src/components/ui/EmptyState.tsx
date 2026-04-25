import React from 'react';
import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { T } from '@/theme';

/**
 * <EmptyState> — centered empty-state with icon, title, body, optional action.
 *
 * Replaces the bespoke "No trips yet / Tap + below to start" patterns
 * scattered across screens. Use anywhere a list might be empty:
 *   <EmptyState
 *     icon="calendar-outline"
 *     title="No trips yet"
 *     body="Tap + below to start your first trip."
 *   />
 *
 * Pass an `action` slot (typically a <Button>) for empty states that
 * have a clear "create" affordance.
 */
interface EmptyStateProps {
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  body?: string;
  action?: React.ReactNode;
}

export function EmptyState({ icon, title, body, action }: EmptyStateProps) {
  return (
    <View
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 48,
        paddingHorizontal: 24,
        gap: 14,
      }}
    >
      {icon ? (
        <View
          style={{
            width: 56,
            height: 56,
            borderRadius: 28,
            backgroundColor: T.greenSoft,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name={icon} size={26} color={T.green} />
        </View>
      ) : null}
      <Text
        style={{
          fontSize: 18,
          fontWeight: '700',
          color: T.ink,
          textAlign: 'center',
        }}
      >
        {title}
      </Text>
      {body ? (
        <Text
          style={{
            fontSize: 14,
            color: T.muted,
            textAlign: 'center',
            lineHeight: 20,
            maxWidth: 320,
          }}
        >
          {body}
        </Text>
      ) : null}
      {action ? <View style={{ marginTop: 8 }}>{action}</View> : null}
    </View>
  );
}
