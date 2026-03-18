import { supabase } from '../supabase';
import type {
  Conversation,
  ConversationMessage,
  ConversationMessageWithMeta,
  ConversationWithPreview,
  Profile,
} from '../../types/database';

// ─── Conversations ────────────────────────────────────────────────────────────

/** All conversations the current user belongs to, ordered by most recent message. */
export async function getConversations(): Promise<ConversationWithPreview[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  // Fetch conversations where current user is a member
  const { data, error } = await supabase
    .from('conversations')
    .select(`
      *,
      conversation_members (
        profile_id,
        joined_at,
        last_read_at,
        profiles:profile_id ( id, name )
      )
    `)
    .order('updated_at', { ascending: false });

  if (error) throw error;

  const convos = data ?? [];

  // Fetch the last message and unread count for each conversation
  const results = await Promise.all(
    convos.map(async (c: any) => {
      const [lastMsgRes, countRes] = await Promise.all([
        supabase
          .from('conversation_messages')
          .select('*')
          .eq('conversation_id', c.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from('conversation_messages')
          .select('id', { count: 'exact', head: true })
          .eq('conversation_id', c.id)
          .gt(
            'created_at',
            c.conversation_members.find((m: any) => m.profile_id === user.id)?.last_read_at ??
              '1970-01-01'
          ),
      ]);

      return {
        ...c,
        members: (c.conversation_members ?? []).map((m: any) => ({
          conversation_id: c.id,
          profile_id: m.profile_id,
          joined_at: m.joined_at,
          last_read_at: m.last_read_at,
          profile: m.profiles,
        })),
        lastMessage: lastMsgRes.data ?? null,
        unreadCount: countRes.count ?? 0,
      } as ConversationWithPreview;
    })
  );

  return results;
}

/** Create or retrieve a 1:1 DM conversation with another user. */
export async function getOrCreateDM(otherProfileId: string): Promise<Conversation> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  // Look for an existing DM between the two users
  const { data: existing } = await supabase
    .from('conversations')
    .select(`
      *,
      conversation_members!inner ( profile_id )
    `)
    .eq('type', 'dm')
    .in('conversation_members.profile_id', [user.id, otherProfileId]);

  if (existing && existing.length > 0) {
    // Find the one that has exactly both participants
    const dm = existing.find((c: any) => {
      const ids = c.conversation_members.map((m: any) => m.profile_id);
      return ids.includes(user.id) && ids.includes(otherProfileId) && ids.length === 2;
    });
    if (dm) return dm as Conversation;
  }

  // Create new DM
  const { data: newConvo, error: convoError } = await supabase
    .from('conversations')
    .insert({ type: 'dm', created_by: user.id })
    .select()
    .single();
  if (convoError) throw convoError;

  // Add both members
  await supabase.from('conversation_members').insert([
    { conversation_id: newConvo.id, profile_id: user.id },
    { conversation_id: newConvo.id, profile_id: otherProfileId },
  ]);

  return newConvo as Conversation;
}

/** Create a group conversation with a name and initial members. */
export async function createGroupConversation(
  name: string,
  memberIds: string[]
): Promise<Conversation> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data: convo, error } = await supabase
    .from('conversations')
    .insert({ type: 'group', name, created_by: user.id })
    .select()
    .single();
  if (error) throw error;

  const allMembers = Array.from(new Set([user.id, ...memberIds]));
  await supabase.from('conversation_members').insert(
    allMembers.map((id) => ({ conversation_id: convo.id, profile_id: id }))
  );

  return convo as Conversation;
}

// ─── Messages ─────────────────────────────────────────────────────────────────

export async function getMessages(conversationId: string): Promise<ConversationMessageWithMeta[]> {
  const { data, error } = await supabase
    .from('conversation_messages')
    .select(`
      *,
      profiles:sender_id ( id, name ),
      conversation_reactions ( id, message_id, profile_id, emoji, created_at,
        profiles:profile_id ( name )
      ),
      reply_to:reply_to_id ( id, content, sender_id )
    `)
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });

  if (error) throw error;

  return (data ?? []).map((row: any) => ({
    id: row.id,
    conversation_id: row.conversation_id,
    sender_id: row.sender_id,
    content: row.content,
    reply_to_id: row.reply_to_id,
    created_at: row.created_at,
    edited_at: row.edited_at,
    senderProfile: row.profiles ?? { id: row.sender_id, name: 'Unknown' },
    reactions: (row.conversation_reactions ?? []).map((r: any) => ({
      ...r,
      senderName: r.profiles?.name ?? 'Unknown',
    })),
    replyTo: row.reply_to ?? null,
  }));
}

export async function sendMessage(
  conversationId: string,
  content: string,
  replyToId?: string
): Promise<ConversationMessage> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('conversation_messages')
    .insert({
      conversation_id: conversationId,
      sender_id: user.id,
      content: content.trim(),
      reply_to_id: replyToId ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return data as ConversationMessage;
}

export async function deleteConversationMessage(messageId: string): Promise<void> {
  const { error } = await supabase
    .from('conversation_messages')
    .delete()
    .eq('id', messageId);
  if (error) throw error;
}

// ─── Reactions ────────────────────────────────────────────────────────────────

export async function addConversationReaction(
  messageId: string,
  emoji: string
): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  await supabase
    .from('conversation_reactions')
    .upsert({ message_id: messageId, profile_id: user.id, emoji });
}

export async function removeConversationReaction(
  messageId: string,
  emoji: string
): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  await supabase
    .from('conversation_reactions')
    .delete()
    .match({ message_id: messageId, profile_id: user.id, emoji });
}

// ─── Mark read ────────────────────────────────────────────────────────────────

export async function markConversationRead(conversationId: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  await supabase
    .from('conversation_members')
    .update({ last_read_at: new Date().toISOString() })
    .match({ conversation_id: conversationId, profile_id: user.id });
}

// ─── People search ────────────────────────────────────────────────────────────

/** Search profiles by name for the new-message composer. */
export async function searchProfiles(query: string): Promise<Pick<Profile, 'id' | 'name' | 'email'>[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from('profiles')
    .select('id, name, email')
    .neq('id', user.id)
    .ilike('name', `%${query}%`)
    .limit(20);

  if (error) throw error;
  return data ?? [];
}
