import { supabase } from '../supabase';
import type { TripMessage, MessageReaction, TripMessageWithReactions } from '../../types/database';

// ─── Messages ─────────────────────────────────────────────────────────────────

export async function getMessagesForTrip(
  tripId: string
): Promise<TripMessageWithReactions[]> {
  const { data: messages, error: msgErr } = await supabase
    .from('trip_messages')
    .select('*')
    .eq('trip_id', tripId)
    .order('created_at', { ascending: true });
  if (msgErr) throw msgErr;

  if (!messages?.length) return [];

  const messageIds = messages.map((m) => m.id);
  const { data: reactions, error: reactErr } = await supabase
    .from('message_reactions')
    .select('*')
    .in('message_id', messageIds);
  if (reactErr) throw reactErr;

  return messages.map((msg) => ({
    ...msg,
    reactions: (reactions ?? []).filter((r) => r.message_id === msg.id),
  }));
}

export async function sendMessage(
  tripId: string,
  content: string,
  itineraryBlockId?: string | null
): Promise<TripMessage> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('trip_messages')
    .insert({
      trip_id: tripId,
      sender_id: user.id,
      content: content.trim(),
      itinerary_block_id: itineraryBlockId ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteMessage(messageId: string): Promise<void> {
  const { error } = await supabase
    .from('trip_messages')
    .delete()
    .eq('id', messageId);
  if (error) throw error;
}

export async function setPinned(
  messageId: string,
  isPinned: boolean
): Promise<void> {
  const { error } = await supabase
    .from('trip_messages')
    .update({ is_pinned: isPinned })
    .eq('id', messageId);
  if (error) throw error;
}

export async function incrementReadCount(messageId: string): Promise<void> {
  // Use a raw increment to avoid race conditions
  let error: unknown = null;
  try {
    await supabase.rpc('increment_message_read_count', { p_message_id: messageId });
  } catch (err) {
    error = err;
  }

  // Fallback if RPC not yet deployed: fetch + update
  if (error) {
    const { data } = await supabase
      .from('trip_messages')
      .select('read_count')
      .eq('id', messageId)
      .single();
    if (data) {
      await supabase
        .from('trip_messages')
        .update({ read_count: data.read_count + 1 })
        .eq('id', messageId);
    }
  }
}

// ─── Reactions ────────────────────────────────────────────────────────────────

export async function addReaction(
  messageId: string,
  reactorId: string,
  reactorType: 'planner' | 'respondent',
  emoji: string
): Promise<MessageReaction> {
  const { data, error } = await supabase
    .from('message_reactions')
    .insert({ message_id: messageId, reactor_id: reactorId, reactor_type: reactorType, emoji })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function removeReaction(
  messageId: string,
  reactorId: string,
  emoji: string
): Promise<void> {
  const { error } = await supabase
    .from('message_reactions')
    .delete()
    .eq('message_id', messageId)
    .eq('reactor_id', reactorId)
    .eq('emoji', emoji);
  if (error) throw error;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Groups reactions by emoji and returns an array of { emoji, count, reactorIds }.
 * Used to render reaction pills on a message.
 */
export function groupReactions(
  reactions: MessageReaction[]
): { emoji: string; count: number; reactorIds: string[] }[] {
  const map = new Map<string, string[]>();
  for (const r of reactions) {
    const ids = map.get(r.emoji) ?? [];
    ids.push(r.reactor_id);
    map.set(r.emoji, ids);
  }
  return Array.from(map.entries()).map(([emoji, reactorIds]) => ({
    emoji,
    count: reactorIds.length,
    reactorIds,
  }));
}
