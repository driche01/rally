import React, { forwardRef } from 'react';
import { Text, TextInput, View, type TextInputProps } from 'react-native';

interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
  hint?: string;
}

export const Input = forwardRef<TextInput, InputProps>(
  ({ label, error, hint, className, ...props }, ref) => {
    return (
      <View className="gap-1">
        {label ? (
          <Text className="text-sm font-medium text-neutral-700">{label}</Text>
        ) : null}
        <TextInput
          ref={ref}
          className={[
            'min-h-[48px] rounded-2xl border px-4 py-3 text-base text-neutral-800',
            'bg-white placeholder:text-neutral-400',
            error
              ? 'border-red-400 focus:border-red-500'
              : 'border-neutral-200 focus:border-coral-500',
            className ?? '',
          ]
            .filter(Boolean)
            .join(' ')}
          placeholderTextColor="#A8A8A8"
          accessible
          accessibilityLabel={label}
          {...props}
        />
        {error ? (
          <Text className="text-sm text-red-500">{error}</Text>
        ) : hint ? (
          <Text className="text-sm text-neutral-400">{hint}</Text>
        ) : null}
      </View>
    );
  }
);

Input.displayName = 'Input';
