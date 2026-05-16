/**
 * Lazy wrapper for `TravelerProfileForm` so the 741-line form doesn't
 * ride in the initial respond-page bundle. The form is only shown on
 * the `survey` step — most visitors hit `polls`/`dates` first and may
 * never reach the survey step.
 */
import { lazy, Suspense, type ComponentProps } from 'react';
import { TravelerProfileForm as TravelerProfileFormType } from './TravelerProfileForm';

const TravelerProfileForm = lazy(() =>
  import('./TravelerProfileForm').then((m) => ({ default: m.TravelerProfileForm })),
);

type Props = ComponentProps<typeof TravelerProfileFormType>;

export function TravelerProfileFormLazy(props: Props) {
  return (
    <Suspense fallback={null}>
      <TravelerProfileForm {...props} />
    </Suspense>
  );
}
