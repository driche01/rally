import React from 'react';
import { View } from 'react-native';
import { SectionHeader } from './SectionHeader';

/**
 * <FormField> — composes a SectionHeader (uppercase label) with any input.
 *
 * Use this for repeating form sections like "Description / Amount /
 * Category / Paid by" in the Add-expense sheet, "Title / Start time /
 * Location / Notes" in the Add-block sheet, etc. The label uses the
 * brand uppercase-tracked style automatically.
 *
 * For one-off labeled inputs (settings page, single-field forms), the
 * `label` prop on <Input> directly is fine — no need for FormField.
 *
 * Usage:
 *   <FormField label="Title" required>
 *     <Input value={title} onChangeText={setTitle} />
 *   </FormField>
 *
 *   <FormField label="Amount" required trailing={<Text>USD</Text>}>
 *     <Input value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
 *   </FormField>
 */
interface FormFieldProps {
  label: string;
  required?: boolean;
  /** Optional helper element rendered to the right of the label
   *  (character count, "Optional", etc.) */
  trailing?: React.ReactNode;
  /** Hint text rendered below the input (when no error). */
  hint?: string;
  children: React.ReactNode;
}

export function FormField({ label, required, trailing, children }: FormFieldProps) {
  return (
    <View>
      <SectionHeader required={required} trailing={trailing} tight>
        {label}
      </SectionHeader>
      {children}
    </View>
  );
}
