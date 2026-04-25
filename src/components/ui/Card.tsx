import React from 'react';
import { Pressable, View, type PressableProps, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';

interface CardProps extends ViewProps {
  children: React.ReactNode;
}

interface PressableCardProps extends PressableProps {
  children: React.ReactNode;
}

// Card surface: bg-card alone is barely distinguishable from bg-cream
// (only 5 hex points apart). The hairline border (border-line, #D9CCB6)
// gives a defined edge; this drop shadow gives it elevation. ~9% opacity
// on a warm palette reads as "lifted," not "popping out."
const CARD_SHADOW = {
  shadowColor:   '#3A2D14',  // warm-tinted shadow for warm surfaces
  shadowOffset:  { width: 0, height: 6 },
  shadowOpacity: 0.09,
  shadowRadius:  16,
  elevation:     4,
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
