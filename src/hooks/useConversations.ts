import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { supabase } from '../lib/supabase';
import {
  addConversationReaction,
  createGroupConversation,
  deleteConversationMessage,
  getConversations,
  getMessages,
  getOrCreateDM,
  getThreadReplies,
  markConversationRead,
  removeConversationReaction,
  searchProfiles,
  sendMessage,
  sendThreadReply,
} from '../lib/api/conversations';

// ─── Query keys ───────────────────────────────────────────────────────────────

export const conversationKeys = {
  all: ['conversations'] as const,
  messages: (id: string) => ['conversations', id, 'messages'] as const,
  thread: (parentId: string) => ['conversations', 'thread', parentId] as const,
};

// ─── Conversations list ───────────────────────────────────────────────────────

export function useConversations() {
  return useQuery({
    queryKey: conversationKeys.all,
    queryFn: getConversations,
  });
}

export function useConversationRealtime() {
  const qc = useQueryClient();
  useEffect(() => {
    const channel = supabase
      .channel('conversations-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'conversation_messages' },
        () => {
          qc.invalidateQueries({ queryKey: conversationKeys.all });
        }
      )
      .subscribe();
    return () => void supabase.removeChannel(channel);
  }, [qc]);
}

// ─── Create ───────────────────────────────────────────────────────────────────

export function useGetOrCreateDM() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (otherProfileId: string) => getOrCreateDM(otherProfileId),
    onSuccess: () => qc.invalidateQueries({ queryKey: conversationKeys.all }),
  });
}

export function useCreateGroupConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, memberIds }: { name: string; memberIds: string[] }) =>
      createGroupConversation(name, memberIds),
    onSuccess: () => qc.invalidateQueries({ queryKey: conversationKeys.all }),
  });
}

// ─── Messages ─────────────────────────────────────────────────────────────────

export function useMessages(conversationId: string) {
  return useQuery({
    queryKey: conversationKeys.messages(conversationId),
    queryFn: () => getMessages(conversationId),
    enabled: Boolean(conversationId),
  });
}

export function useMessagesRealtime(conversationId: string) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!conversationId) return;
    const channel = supabase
      .channel(`messages:${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'conversation_messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        () => qc.invalidateQueries({ queryKey: conversationKeys.messages(conversationId) })
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'conversation_reactions' },
        () => qc.invalidateQueries({ queryKey: conversationKeys.messages(conversationId) })
      )
      .subscribe();
    return () => void supabase.removeChannel(channel);
  }, [conversationId, qc]);
}

export function useSendMessage(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ content, replyToId }: { content: string; replyToId?: string }) =>
      sendMessage(conversationId, content, replyToId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: conversationKeys.messages(conversationId) });
      qc.invalidateQueries({ queryKey: conversationKeys.all });
    },
  });
}

export function useDeleteMessage(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (messageId: string) => deleteConversationMessage(messageId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: conversationKeys.messages(conversationId) });
      qc.invalidateQueries({ queryKey: conversationKeys.all });
    },
  });
}

export function useAddReaction(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ messageId, emoji }: { messageId: string; emoji: string }) =>
      addConversationReaction(messageId, emoji),
    onSuccess: () => qc.invalidateQueries({ queryKey: conversationKeys.messages(conversationId) }),
  });
}

export function useRemoveReaction(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ messageId, emoji }: { messageId: string; emoji: string }) =>
      removeConversationReaction(messageId, emoji),
    onSuccess: () => qc.invalidateQueries({ queryKey: conversationKeys.messages(conversationId) }),
  });
}

export function useMarkRead(conversationId: string) {
  return useMutation({
    mutationFn: () => markConversationRead(conversationId),
  });
}

// ─── Threads ──────────────────────────────────────────────────────────────────

export function useThreadReplies(parentMessageId: string | null) {
  return useQuery({
    queryKey: conversationKeys.thread(parentMessageId ?? ''),
    queryFn: () => getThreadReplies(parentMessageId!),
    enabled: Boolean(parentMessageId),
  });
}

export function useThreadRepliesRealtime(parentMessageId: string | null, conversationId: string) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!parentMessageId) return;
    const channel = supabase
      .channel(`thread:${parentMessageId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'conversation_messages',
          filter: `thread_parent_id=eq.${parentMessageId}`,
        },
        () => {
          qc.invalidateQueries({ queryKey: conversationKeys.thread(parentMessageId) });
          // Also refresh the main feed so the reply count badge updates
          qc.invalidateQueries({ queryKey: conversationKeys.messages(conversationId) });
        }
      )
      .subscribe();
    return () => void supabase.removeChannel(channel);
  }, [parentMessageId, conversationId, qc]);
}

export function useSendThreadReply(conversationId: string, parentMessageId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (content: string) => sendThreadReply(conversationId, parentMessageId, content),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: conversationKeys.thread(parentMessageId) });
      qc.invalidateQueries({ queryKey: conversationKeys.messages(conversationId) });
    },
  });
}

// ─── People search ────────────────────────────────────────────────────────────

export function useProfileSearch(query: string) {
  return useQuery({
    queryKey: ['profileSearch', query],
    queryFn: () => searchProfiles(query),
    enabled: query.trim().length > 0,
    staleTime: 10_000,
  });
}
