/**
 * Tiny wrapper around expo-haptics for the trip-card form's chip-add
 * micro-interactions. We use `impactAsync(Light)` consistently — feels
 * like a soft tap on commit, never intrusive. Wrap in try/catch because
 * haptics aren't available in every environment (web, simulator config,
 * permission denied) and we never want a missing capability to surface
 * as an unhandled rejection.
 */
import * as Haptics from 'expo-haptics';

export async function tapHaptic(): Promise<void> {
  try {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  } catch {
    /* no-op */
  }
}
