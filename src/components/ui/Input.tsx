import React, { forwardRef } from 'react';
import { Text, TextInput, View, type TextInputProps } from 'react-native';

// Placeholder text — slightly desaturated to read as hint on cream/card.
// Local-only (not part of brand T).
const PLACEHOLDER = '#9DA8A0';

interface InputProps extends TextInputProps {
  /** Optional label rendered above the input. Use for one-off inputs.
   *  For repeating form fields prefer <FormField> which composes this with
   *  a SectionHeader and error text. */
  label?: string;
  /** Inline error message — switches the border to error color. */
  error?: string;
  /** Helper hint shown beneath when there's no error. */
  hint?: string;
  /** Render as a multi-line textarea (3+ rows). */
  multiline?: boolean;
}

// Subtle drop shadow gives the input a clear lift off cream-page surfaces.
// Warm-tinted shadow blends with the brand surface; ~6% opacity reads as
// "input box" without screaming.
const INPUT_SHADOW = {
  shadowColor:   '#3A2D14',
  shadowOffset:  { width: 0, height: 3 },
  shadowOpacity: 0.06,
  shadowRadius:  8,
  elevation:     2,
};

/**
 * <Input> — single-line or multi-line text input.
 *
 * 2026-04-24 brand: warm cream surfaces, ink text, hairline borders,
 * green focus state. No pure white, no neutral grays in primary surfaces.
 *
 * Pass `multiline` for textarea behavior (~88px tall, 3-row default,
 * grows with content). Pass `label` + optional `error` / `hint` for the
 * common labeled-input pattern; for repeating form fields, prefer
 * <FormField> which adds a SectionHeader for proper section semantics.
 */
export const Input = forwardRef<TextInput, InputProps>(
  ({ label, error, hint, multiline = false, className, style, ...props }, ref) => {
    const heightClass = multiline ? 'min-h-[88px]' : 'min-h-[48px]';
    return (
      <View className="gap-1">
        {label ? (
          <Text className="text-sm font-medium text-ink">{label}</Text>
        ) : null}
        <TextInput
          ref={ref}
          multiline={multiline}
          textAlignVertical={multiline ? 'top' : 'center'}
          className={[
            `${heightClass} rounded-md border px-4 py-3 text-base text-ink`,
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
