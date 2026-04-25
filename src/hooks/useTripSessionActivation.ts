/**
 * Subscribes to a pre-created `trip_sessions` row and reports whether
 * it has been "activated" by a real group message landing.
 *
 * Used by the activate-sms screen (Phase 4): after the planner taps
 * "Get Rally to run this in my group", we pre-create a session with
 * a placeholder thread_id (`app_pending_<tripId>`). When the first
 * inbound group message arrives, the inbound-processor reassigns the
 * thread_id to the real group hash and updates `last_message_at`.
 * That update is the signal we surface here.
 *
 * Mirrors the realtime pattern in `useMessages.ts::useMessageRealtime`.
 */
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

export interface TripSessionState {
  /** True after the inbound processor has flipped the thread_id. */
  activated: boolean;
  /** True while the initial fetch is in flight. */
  loading: boolean;
  /** Last server timestamp we observed for `last_message_at`. */
  lastMessageAt: string | null;
  /** Real (or placeholder) thread id — useful for debugging / display. */
  threadId: string | null;
}

export function useTripSessionActivation(sessionId: string | null): TripSessionState {
  const [state, setState] = useState<TripSessionState>({
    activated: false,
    loading: true,
    lastMessageAt: null,
    threadId: null,
  });

  useEffect(() => {
    if (!sessionId) {
      setState({ activated: false, loading: false, lastMessageAt: null, threadId: null });
      return;
    }

    let cancelled = false;
    const compute = (row: { thread_id?: string | null; last_message_at?: string | null; created_at?: string | null }) => {
      const tId = row.thread_id ?? null;
      const lastMsg = row.last_message_at ?? null;
      // "Activated" = the inbound-processor handoff has fired. Two
      // cleaner signals than time-comparisons: thread_id no longer
      // starts with `app_pending_`, OR last_message_at has been bumped
      // since the row was created (gives the inbound processor room to
      // update either field — it sets both atomically).
      const renamed = tId !== null && !tId.startsWith('app_pending_');
      const created = row.created_at ? new Date(row.created_at).getTime() : 0;
      const lastMs = lastMsg ? new Date(lastMsg).getTime() : 0;
      const bumped = created > 0 && lastMs > created + 2_000;
      return { activated: renamed || bumped, loading: false, lastMessageAt: lastMsg, threadId: tId };
    };

    // Initial fetch
    supabase
      .from('trip_sessions')
      .select('thread_id, last_message_at, created_at')
      .eq('id', sessionId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        if (data) setState(compute(data));
        else setState({ activated: false, loading: false, lastMessageAt: null, threadId: null });
      });

    // Realtime: any update to this trip_sessions row re-computes activation.
    const channel = supabase
      .channel(`trip_session:${sessionId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'trip_sessions',
          filter: `id=eq.${sessionId}`,
        },
        (payload: { new: { thread_id?: string | null; last_message_at?: string | null; created_at?: string | null } }) => {
          if (cancelled) return;
          if (payload?.new) setState(compute(payload.new));
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [sessionId]);

  return state;
}
