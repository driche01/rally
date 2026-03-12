import React from 'react';
import { Pressable, View, type PressableProps, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';

interface CardProps extends ViewProps {
  children: React.ReactNode;
}

interface PressableCardProps extends PressableProps {
  children: React.ReactNode;
}

export function Card({ children, className, ...props }: CardProps & { className?: string }) {
  return (
    <View
      className={[
        'rounded-2xl bg-white p-4',
        'shadow-sm',
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 8,
        elevation: 3,
      }}
      {...props}
    >
      {children}
    </View>
  );
}

export function PressableCard({
  children,
  className,
  style,
  ...props
}: PressableCardProps & { className?: string; style?: StyleProp<ViewStyle> }) {
  return (
    <Pressable
      className={[
        'rounded-2xl bg-white p-4 active:bg-neutral-50',
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={[
        {
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.08,
          shadowRadius: 8,
          elevation: 3,
        },
        style,
      ]}
      accessible
      accessibilityRole="button"
      {...props}
    >
      {children}
    </Pressable>
  );
}
