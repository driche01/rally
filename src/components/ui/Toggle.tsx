import React from 'react';
import { Switch, type SwitchProps } from 'react-native';

/**
 * <Toggle> — branded RN Switch wrapper.
 *
 * Replaces inline `<Switch trackColor={{ true: '#C8ECD9' }} thumbColor=...>`
 * patterns. Brand colors locked at the source so on/off states stay
 * consistent.
 */
type ToggleProps = Omit<SwitchProps, 'trackColor' | 'thumbColor' | 'ios_backgroundColor'>;

export function Toggle(props: ToggleProps) {
  return (
    <Switch
      trackColor={{ false: '#D9CCB6', true: '#C8ECD9' }}
      thumbColor={props.value ? '#0F3F2E' : '#FFFCF6'}
      ios_backgroundColor="#D9CCB6"
      {...props}
    />
  );
}
