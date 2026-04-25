import React from 'react';
import { Pressable, View, type PressableProps, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';

interface CardProps extends ViewProps {
  children: React.ReactNode;
}

interface PressableCardProps extends PressableProps {
  children: React.ReactNode;
}

// Card surface: bg-card alone is barely distinguishable from bg-cream
// (only 5 hex points apart). Adding (a) a hairline border and (b) a slightly
// stronger drop shadow gives the card a clear edge against the page.
const CARD_SHADOW = {
  shadowColor:   '#1A1A1A',
  shadowOffset:  { width: 0, height: 4 },
  shadowOpacity: 0.06,
  shadowRadius:  14,
  elevation:     3,
};

export function Card({ children, className, ...props }: CardProps & { className?: string }) {
  return (
    <View
      className={[
        'rounded-2xl border border-line bg-card p-4',
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={CARD_SHADOW}
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
        'rounded-2xl border border-line bg-card p-4 active:bg-cream-warm',
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={[CARD_SHADOW, style]}
      accessible
      accessibilityRole="button"
      {...props}
    >
      {children}
    </Pressable>
  );
}
