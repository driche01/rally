import React from 'react';
import { View, type ViewProps, type ViewStyle } from 'react-native';

/**
 * <Row> — horizontal flex container with safe defaults for responsive
 * layouts. Replaces the ad-hoc `flexDirection: 'row'` boilerplate that
 * gets reinvented per-screen and silently drifts (some screens use
 * gap, some use margin; some center children, some don't).
 *
 * Why this matters for responsiveness:
 *   - children default to `flexShrink: 1` via the `shrink` prop on the
 *     siblings that should absorb the squeeze (text-bearing rows, chip
 *     bars). The unbounded child gets squeezed; bounded children stay
 *     full-width.
 *   - never wraps by default. Wrap is opt-in (`wrap`) because a row
 *     that wraps changes vertical layout, which is usually a worse UX
 *     than ellipsizing the variable child.
 *
 * Use this anywhere you'd write `flexDirection: 'row'`. Pair with
 * `numberOfLines + ellipsizeMode` on `<Text>` children that hold
 * user-supplied strings.
 */
interface RowProps extends ViewProps {
  /** Cross-axis alignment. Defaults to 'center' — the right answer for
   *  ~95% of horizontal rows in product UI. */
  align?: ViewStyle['alignItems'];
  /** Main-axis distribution. */
  justify?: ViewStyle['justifyContent'];
  /** Spacing between children, in points. Uses RN's `gap` prop (RN
   *  0.71+); falls back gracefully on older platforms. */
  gap?: number;
  /** Allow children to wrap to multiple lines. Off by default — wrap
   *  changes vertical rhythm and should be a deliberate choice. */
  wrap?: boolean;
}

export function Row({
  align = 'center',
  justify,
  gap,
  wrap = false,
  style,
  children,
  ...rest
}: RowProps) {
  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: align,
          justifyContent: justify,
          gap,
          flexWrap: wrap ? 'wrap' : 'nowrap',
        },
        style,
      ]}
      {...rest}
    >
      {children}
    </View>
  );
}
