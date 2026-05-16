/**
 * Lazy wrapper around `MultiDatePicker` so `react-native-calendars`
 * doesn't ride in the initial bundle. The calendar chunk is fetched
 * the first time the picker is opened (`visible` becomes true) and
 * cached for subsequent opens.
 *
 * Keeps the same prop shape as `MultiDatePicker` — swap the import
 * with no other changes at the call site.
 */
import { lazy, Suspense, type ComponentProps } from 'react';
import { MultiDatePicker as MultiDatePickerType } from './MultiDatePicker';

const MultiDatePicker = lazy(() =>
  import('./MultiDatePicker').then((m) => ({ default: m.MultiDatePicker })),
);

type Props = ComponentProps<typeof MultiDatePickerType>;

export function MultiDatePickerLazy(props: Props) {
  // Don't pay the import cost until the picker is actually opened.
  if (!props.visible) return null;
  return (
    <Suspense fallback={null}>
      <MultiDatePicker {...props} />
    </Suspense>
  );
}
