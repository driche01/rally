import { useWindowDimensions } from 'react-native';

/**
 * Single source of truth for "what size phone is this?"
 *
 * Buckets follow the iPhone fleet at the time of writing:
 *   compact  — iPhone SE 1st/2nd/3rd gen, iPhone 13 mini  (≤ 375pt)
 *   regular  — iPhone 14/15/16 + Pro                       (376–430pt)
 *   large    — iPhone Pro Max + landscape phones + iPad   (≥ 431pt)
 *
 * Re-renders on rotation, split-view, and Dynamic Island toggles
 * (useWindowDimensions subscribes to dimension changes; Dimensions.get
 * does not).
 *
 * Use sparingly — flex-based layouts with flexShrink/numberOfLines
 * handle most responsive needs without branching. Reach for this only
 * when the design genuinely needs a different layout per bucket
 * (e.g., 2-column at large vs 1-column at compact).
 */
export type Breakpoint = 'compact' | 'regular' | 'large';

export function useBreakpoint(): Breakpoint {
  const { width } = useWindowDimensions();
  if (width <= 375) return 'compact';
  if (width <= 430) return 'regular';
  return 'large';
}

/**
 * Returns true when the device is in the compact bucket. Convenience
 * wrapper for the most common branching ("hide secondary affordance on
 * small phones").
 */
export function useIsCompact(): boolean {
  return useBreakpoint() === 'compact';
}
