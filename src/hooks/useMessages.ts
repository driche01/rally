import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getMessagesForTrip,
  sendMessage,
  deleteMessage,
  setPinned,
  incrementReadCount,
  addReaction,
  removeReaction,
} from '@/lib/api/messages';
import { supabase } from '@/lib/supabase';
import { queryClient } from '@/lib/queryClient';

export const messageKeys = {
  all: (tripId: string) => ['messages', tripId] as const,
};

export function useMessages(tripId: string) {
  return useQuery({
    queryKey: messageKeys.all(tripId),
    queryFn: () => getMessagesForTrip(tripId),
    enabled: !!tripId,
  });
}

/** Subscribes to real-time inserts/updates on trip_messages for this trip. */
export function useMessageRealtime(tripId: string) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!tripId) return;
    const channel = supabase
      .channel(`messages:${tripId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'trip_messages', filter: `trip_id=eq.${tripId}` },
        () => qc.invalidateQueries({ queryKey: messageKeys.all(tripId) })
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'message_reactions' },
        () => qc.invalidateQueries({ queryKey: messageKeys.all(tripId) })
      )
      .subscribe();
    return () => void supabase.removeChannel(channel);
  }, [tripId, qc]);
}

export function useSendMessage(tripId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      content,
      itineraryBlockId,
    }: {
      content: string;
      itineraryBlockId?: string | null;
    }) => sendMessage(tripId, content, itineraryBlockId),
    onSuccess: () => qc.invalidateQueries({ queryKey: messageKeys.all(tripId) }),
  });
}

export function useDeleteMessage(tripId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (messageId: string) => deleteMessage(messageId),
    onSuccess: () => qc.invalidateQueries({ queryKey: messageKeys.all(tripId) }),
  });
}

export function useSetPinned(tripId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ messageId, isPinned }: { messageId: string; isPinned: boolean }) =>
      setPinned(messageId, isPinned),
    onSuccess: () => qc.invalidateQueries({ queryKey: messageKeys.all(tripId) }),
  });
}

export function useAddReaction(tripId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      messageId,
      reactorId,
      reactorType,
      emoji,
    }: {
      messageId: string;
      reactorId: string;
      reactorType: 'planner' | 'respondent';
      emoji: string;
    }) => addReaction(messageId, reactorId, reactorType, emoji),
    onSuccess: () => qc.invalidateQueries({ queryKey: messageKeys.all(tripId) }),
  });
}

export function useRemoveReaction(tripId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      messageId,
      reactorId,
      emoji,
    }: {
      messageId: string;
      reactorId: string;
      emoji: string;
    }) => removeReaction(messageId, reactorId, emoji),
    onSuccess: () => qc.invalidateQueries({ queryKey: messageKeys.all(tripId) }),
  });
}
