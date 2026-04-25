import React from 'react';
import { Text, View } from 'react-native';

interface ProgressBarProps {
  value: number;
  max?: number;
  label?: string;
  showPercent?: boolean;
}

export function ProgressBar({ value, max = 100, label, showPercent = false }: ProgressBarProps) {
  const percent = Math.min(100, Math.round((value / max) * 100));

  return (
    <View className="gap-1">
      {(label || showPercent) ? (
        <View className="flex-row justify-between">
          {label ? <Text className="text-sm text-neutral-600">{label}</Text> : <View />}
          {showPercent ? (
            <Text className="text-sm font-medium text-neutral-800">{percent}%</Text>
          ) : null}
        </View>
      ) : null}
      <View className="h-2 overflow-hidden rounded-full bg-neutral-100">
        <View
          className="h-full rounded-full bg-green"
          style={{ width: `${percent}%` }}
        />
      </View>
    </View>
  );
}
