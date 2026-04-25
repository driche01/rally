import React, { forwardRef } from 'react';
import { Text, TextInput, View, type TextInputProps } from 'react-native';

// Placeholder text — slightly desaturated to read as hint on cream/card.
// Local-only (not part of brand T).
const PLACEHOLDER = '#9DA8A0';

interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
  hint?: string;
}

// Subtle drop shadow gives the input a clear lift off cream-page surfaces.
// Without it, bg-card (#FFFAF2) on bg-cream (#FBF7EF) is barely visible.
const INPUT_SHADOW = {
  shadowColor:   '#1A1A1A',
  shadowOffset:  { width: 0, height: 2 },
  shadowOpacity: 0.04,
  shadowRadius:  6,
  elevation:     1,
};

// 2026-04-24 brand palette: warm cream surfaces, ink text, hairline borders,
// green focus state. No pure white, no neutral grays in primary surfaces.
export const Input = forwardRef<TextInput, InputProps>(
  ({ label, error, hint, className, style, ...props }, ref) => {
    return (
      <View className="gap-1">
        {label ? (
          <Text className="text-sm font-medium text-ink">{label}</Text>
        ) : null}
        <TextInput
          ref={ref}
          className={[
            'min-h-[48px] rounded-md border px-4 py-3 text-base text-ink',
            'bg-card placeholder:text-muted',
            error
              ? 'border-red-400 focus:border-red-500'
              : 'border-line focus:border-green',
            className ?? '',
          ]
            .filter(Boolean)
            .join(' ')}
          placeholderTextColor={PLACEHOLDER}
          style={[INPUT_SHADOW, style]}
          accessible
          accessibilityLabel={label}
          {...props}
        />
        {error ? (
          <Text className="text-sm text-red-500">{error}</Text>
        ) : hint ? (
          <Text className="text-sm text-muted">{hint}</Text>
        ) : null}
      </View>
    );
  }
);

Input.displayName = 'Input';
