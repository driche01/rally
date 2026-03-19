/**
 * Chat thread — full-screen DM or group conversation.
 * Messages in bubbles (right = me, left = others), emoji reactions,
 * reply-to, long-press context menu, real-time updates.
 * Threads: tap "N replies" below a message to open the thread panel.
 */
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '@/stores/authStore';
import {
  useAddReaction,
  useConversations,
  useDeleteMessage,
  useMarkRead,
  useMessages,
  useMessagesRealtime,
  useRemoveReaction,
  useSendMessage,
  useSendThreadReply,
  useThreadReplies,
  useThreadRepliesRealtime,
} from '@/hooks/useConversations';
import type { ConversationMessageWithMeta } from '@/types/database';

// ─── Constants ────────────────────────────────────────────────────────────────

const REACTION_EMOJIS = ['❤️', '😂', '🔥', '👍', '🙌', '✈️'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function formatDateDivider(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

function initials(name: string): string {
  return name.split(' ').map((w) => w[0] ?? '').slice(0, 2).join('').toUpperCase();
}

const AVATAR_COLORS = ['#D85A30', '#235C38', '#1A4060', '#7C3AED', '#0891B2', '#BE185D'];
function avatarColor(id: string): string {
  let n = 0;
  for (let i = 0; i < id.length; i++) n += id.charCodeAt(i);
  return AVATAR_COLORS[n % AVATAR_COLORS.length];
}

// ─── Mini avatar ──────────────────────────────────────────────────────────────

function MiniAvatar({ name, id }: { name: string; id: string }) {
  return (
    <View style={[styles.miniAvatar, { backgroundColor: avatarColor(id) }]}>
      <Text style={styles.miniAvatarText}>{initials(name)}</Text>
    </View>
  );
}

// ─── Reaction pill ────────────────────────────────────────────────────────────

function ReactionPill({
  emoji,
  count,
  mine,
  onPress,
}: {
  emoji: string;
  count: number;
  mine: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.reactionPill, mine && styles.reactionPillMine]}
    >
      <Text style={styles.reactionEmoji}>{emoji}</Text>
      {count > 1 ? <Text style={[styles.reactionCount, mine && { color: '#D85A30' }]}>{count}</Text> : null}
    </Pressable>
  );
}

// ─── Message bubble ───────────────────────────────────────────────────────────

const MessageBubble = ({
  msg,
  isMe,
  isGroup,
  showAvatar,
  showDateDivider,
  prevDate,
  onLongPress,
  onReactionPress,
  onOpenThread,
  currentUserId,
}: {
  msg: ConversationMessageWithMeta;
  isMe: boolean;
  isGroup: boolean;
  showAvatar: boolean;
  showDateDivider: boolean;
  prevDate: string | null;
  onLongPress: (msg: ConversationMessageWithMeta) => void;
  onReactionPress: (messageId: string, emoji: string, alreadyReacted: boolean) => void;
  onOpenThread: (msg: ConversationMessageWithMeta) => void;
  currentUserId: string;
}) => {
  // Group reactions by emoji
  const grouped = useMemo(() => {
    const map = new Map<string, { count: number; mine: boolean }>();
    for (const r of msg.reactions) {
      const existing = map.get(r.emoji);
      if (existing) {
        existing.count++;
        if (r.profile_id === currentUserId) existing.mine = true;
      } else {
        map.set(r.emoji, { count: 1, mine: r.profile_id === currentUserId });
      }
    }
    return Array.from(map.entries());
  }, [msg.reactions, currentUserId]);

  const dateLabel = showDateDivider ? formatDateDivider(msg.created_at) : null;
  const replyCount = msg.thread_reply_count ?? 0;

  return (
    <>
      {dateLabel ? (
        <View style={styles.dateDivider}>
          <Text style={styles.dateDividerText}>{dateLabel}</Text>
        </View>
      ) : null}

      <View style={[styles.messageRow, isMe && styles.messageRowMe]}>
        {/* Avatar — left side for group chats, other's messages */}
        {isGroup && !isMe ? (
          <View style={{ width: 32, alignSelf: 'flex-end', marginBottom: grouped.length > 0 || replyCount > 0 ? 18 : 0 }}>
            {showAvatar ? <MiniAvatar name={msg.senderProfile.name} id={msg.sender_id} /> : null}
          </View>
        ) : null}

        <View style={[styles.bubbleCol, isMe && styles.bubbleColMe]}>
          {/* Sender name — group only, above every message */}
          {isGroup ? (
            <Text style={[styles.senderName, isMe && styles.senderNameMe]}>{msg.senderProfile.name}</Text>
          ) : null}

          {/* Reply-to snippet */}
          {msg.replyTo ? (
            <View style={[styles.replySnippet, isMe && styles.replySnippetMe]}>
              <Text style={styles.replyText} numberOfLines={1}>
                {msg.replyTo.content}
              </Text>
            </View>
          ) : null}

          {/* Bubble */}
          <Pressable
            onLongPress={() => onLongPress(msg)}
            delayLongPress={350}
            style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleThem]}
          >
            <Text style={[styles.bubbleText, isMe && styles.bubbleTextMe]}>
              {msg.content}
            </Text>
          </Pressable>

          {/* Time */}
          <Text style={[styles.timestamp, isMe && styles.timestampMe]}>
            {formatTime(msg.created_at)}
            {msg.edited_at ? '  · Edited' : ''}
          </Text>

          {/* Reactions */}
          {grouped.length > 0 ? (
            <View style={[styles.reactions, isMe && styles.reactionsMe]}>
              {grouped.map(([emoji, { count, mine }]) => (
                <ReactionPill
                  key={emoji}
                  emoji={emoji}
                  count={count}
                  mine={mine}
                  onPress={() => onReactionPress(msg.id, emoji, mine)}
                />
              ))}
            </View>
          ) : null}

          {/* Thread reply count */}
          {replyCount > 0 ? (
            <Pressable
              onPress={() => onOpenThread(msg)}
              style={[styles.threadBadge, isMe && styles.threadBadgeMe]}
            >
              <Ionicons name="chatbubble-outline" size={12} color="#D85A30" />
              <Text style={styles.threadBadgeText}>
                {replyCount} {replyCount === 1 ? 'reply' : 'replies'}
              </Text>
              <Ionicons name="chevron-forward" size={11} color="#D85A30" />
            </Pressable>
          ) : null}
        </View>
      </View>
    </>
  );
};

// ─── Context menu (long press) ────────────────────────────────────────────────

function ContextMenu({
  visible,
  isMe,
  message,
  onReact,
  onReply,
  onReplyInThread,
  onDelete,
  onClose,
}: {
  visible: boolean;
  isMe: boolean;
  message: ConversationMessageWithMeta | null;
  onReact: (emoji: string) => void;
  onReply: () => void;
  onReplyInThread: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  if (!message) return null;
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.menuOverlay} onPress={onClose}>
        <Pressable onPress={() => {}} style={styles.menuCard}>
          {/* Quoted message preview */}
          <View style={styles.menuPreview}>
            <Text style={styles.menuPreviewText} numberOfLines={2}>{message.content}</Text>
          </View>

          {/* Emoji tray */}
          <View style={styles.emojiTray}>
            {REACTION_EMOJIS.map((e) => (
              <Pressable
                key={e}
                onPress={() => { onReact(e); onClose(); }}
                style={styles.emojiBtn}
              >
                <Text style={styles.emojiText}>{e}</Text>
              </Pressable>
            ))}
          </View>

          {/* Actions */}
          <View style={styles.menuActions}>
            <Pressable onPress={() => { onReply(); onClose(); }} style={styles.menuAction}>
              <Ionicons name="return-down-back-outline" size={18} color="#444" />
              <Text style={styles.menuActionText}>Reply</Text>
            </Pressable>
            <Pressable onPress={() => { onReplyInThread(); onClose(); }} style={styles.menuAction}>
              <Ionicons name="chatbubbles-outline" size={18} color="#444" />
              <Text style={styles.menuActionText}>Reply in thread</Text>
            </Pressable>
            {isMe ? (
              <Pressable
                onPress={() => { onDelete(); onClose(); }}
                style={[styles.menuAction, styles.menuActionDestructive]}
              >
                <Ionicons name="trash-outline" size={18} color="#EF4444" />
                <Text style={[styles.menuActionText, { color: '#EF4444' }]}>Delete</Text>
              </Pressable>
            ) : null}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ─── Thread panel ─────────────────────────────────────────────────────────────

function ThreadPanel({
  parentMsg,
  conversationId,
  currentUserId,
  isGroup,
  onClose,
}: {
  parentMsg: ConversationMessageWithMeta;
  conversationId: string;
  currentUserId: string;
  isGroup: boolean;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState('');
  const listRef = useRef<FlatList>(null);

  const { data: replies = [] } = useThreadReplies(parentMsg.id);
  useThreadRepliesRealtime(parentMsg.id, conversationId);
  const sendReply = useSendThreadReply(conversationId, parentMsg.id);

  useEffect(() => {
    if (replies.length > 0) {
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
    }
  }, [replies.length]);

  function handleSend() {
    const content = draft.trim();
    if (!content) return;
    sendReply.mutate(content, { onSuccess: () => setDraft('') });
  }

  const isMe = parentMsg.sender_id === currentUserId;

  return (
    <View style={[styles.threadPanel, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.threadHeader}>
        <Text style={styles.threadHeaderTitle}>Thread</Text>
        <Pressable onPress={onClose} hitSlop={8} style={styles.threadCloseBtn}>
          <Ionicons name="close" size={22} color="#1a1a1a" />
        </Pressable>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        <FlatList
          ref={listRef}
          data={replies}
          keyExtractor={(m) => m.id}
          contentContainerStyle={styles.threadList}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          ListHeaderComponent={
            <>
              {/* Parent message pinned at top */}
              <View style={styles.threadParentWrapper}>
                <View style={[styles.messageRow, isMe && styles.messageRowMe]}>
                  {isGroup && !isMe ? (
                    <View style={{ width: 32, alignSelf: 'flex-end' }}>
                      <MiniAvatar name={parentMsg.senderProfile.name} id={parentMsg.sender_id} />
                    </View>
                  ) : null}
                  <View style={[styles.bubbleCol, isMe && styles.bubbleColMe]}>
                    {isGroup ? (
                      <Text style={[styles.senderName, isMe && styles.senderNameMe]}>
                        {parentMsg.senderProfile.name}
                      </Text>
                    ) : null}
                    <View style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleThem]}>
                      <Text style={[styles.bubbleText, isMe && styles.bubbleTextMe]}>
                        {parentMsg.content}
                      </Text>
                    </View>
                    <Text style={[styles.timestamp, isMe && styles.timestampMe]}>
                      {formatTime(parentMsg.created_at)}
                    </Text>
                  </View>
                </View>
              </View>

              <View style={styles.threadDivider}>
                <View style={styles.threadDividerLine} />
                <Text style={styles.threadDividerLabel}>
                  {replies.length} {replies.length === 1 ? 'reply' : 'replies'}
                </Text>
                <View style={styles.threadDividerLine} />
              </View>
            </>
          }
          ListEmptyComponent={
            <View style={styles.threadEmptyReplies}>
              <Text style={styles.threadEmptyText}>No replies yet. Start the thread!</Text>
            </View>
          }
          renderItem={({ item }) => {
            const replyIsMe = item.sender_id === currentUserId;
            return (
              <View style={[styles.messageRow, replyIsMe && styles.messageRowMe, { marginBottom: 4 }]}>
                {isGroup && !replyIsMe ? (
                  <View style={{ width: 32, alignSelf: 'flex-end' }}>
                    <MiniAvatar name={item.senderProfile.name} id={item.sender_id} />
                  </View>
                ) : null}
                <View style={[styles.bubbleCol, replyIsMe && styles.bubbleColMe]}>
                  {isGroup ? (
                    <Text style={[styles.senderName, replyIsMe && styles.senderNameMe]}>
                      {item.senderProfile.name}
                    </Text>
                  ) : null}
                  <View style={[styles.bubble, replyIsMe ? styles.bubbleMe : styles.bubbleThem]}>
                    <Text style={[styles.bubbleText, replyIsMe && styles.bubbleTextMe]}>
                      {item.content}
                    </Text>
                  </View>
                  <Text style={[styles.timestamp, replyIsMe && styles.timestampMe]}>
                    {formatTime(item.created_at)}
                  </Text>
                </View>
              </View>
            );
          }}
        />

        {/* Composer */}
        <View style={[styles.inputBar, { paddingBottom: insets.bottom + 8 }]}>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder="Reply in thread…"
            placeholderTextColor="#aaa"
            multiline
            maxLength={2000}
            returnKeyType="default"
          />
          <Pressable
            onPress={handleSend}
            disabled={!draft.trim() || sendReply.isPending}
            style={[styles.sendBtn, !draft.trim() && styles.sendBtnDisabled]}
            accessibilityRole="button"
            accessibilityLabel="Send reply"
          >
            <Ionicons name="arrow-up" size={18} color="#fff" />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function ConversationScreen() {
  const { conversationId } = useLocalSearchParams<{ conversationId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();

  const { data: conversations = [] } = useConversations();
  const convo = conversations.find((c) => c.id === conversationId);

  const { data: messages = [] } = useMessages(conversationId);
  useMessagesRealtime(conversationId);
  const markRead = useMarkRead(conversationId);

  const sendMessage = useSendMessage(conversationId);
  const deleteMessage = useDeleteMessage(conversationId);
  const addReaction = useAddReaction(conversationId);
  const removeReaction = useRemoveReaction(conversationId);

  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<ConversationMessageWithMeta | null>(null);
  const [contextMsg, setContextMsg] = useState<ConversationMessageWithMeta | null>(null);
  const [threadMsg, setThreadMsg] = useState<ConversationMessageWithMeta | null>(null);
  const listRef = useRef<FlatList>(null);

  // Mark read on mount and when new messages arrive
  useEffect(() => {
    markRead.mutate();
  }, [messages.length]);

  // Scroll to bottom on new messages
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
    }
  }, [messages.length]);

  const displayName = useMemo(() => {
    if (!convo) return '';
    if (convo.type === 'dm') {
      return convo.members.find((m) => m.profile_id !== user?.id)?.profile.name ?? 'Unknown';
    }
    return convo.name ?? 'Group chat';
  }, [convo, user?.id]);

  const isGroup = convo?.type === 'group';

  function handleSend() {
    const content = draft.trim();
    if (!content) return;
    sendMessage.mutate(
      { content, replyToId: replyTo?.id },
      { onSuccess: () => { setDraft(''); setReplyTo(null); } }
    );
  }

  function handleLongPress(msg: ConversationMessageWithMeta) {
    setContextMsg(msg);
  }

  function handleReact(messageId: string, emoji: string, alreadyReacted: boolean) {
    if (alreadyReacted) {
      removeReaction.mutate({ messageId, emoji });
    } else {
      addReaction.mutate({ messageId, emoji });
    }
  }

  function handleDelete() {
    if (!contextMsg) return;
    Alert.alert('Delete message?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => deleteMessage.mutate(contextMsg.id),
      },
    ]);
  }

  const renderItem = useCallback(
    ({ item, index }: { item: ConversationMessageWithMeta; index: number }) => {
      const isMe = item.sender_id === user?.id;
      const prev = index > 0 ? messages[index - 1] : null;
      const showAvatar = !prev || prev.sender_id !== item.sender_id;
      const showDateDivider =
        !prev ||
        new Date(item.created_at).toDateString() !== new Date(prev.created_at).toDateString();

      return (
        <MessageBubble
          msg={item}
          isMe={isMe}
          isGroup={!!isGroup}
          showAvatar={showAvatar}
          showDateDivider={showDateDivider}
          prevDate={prev?.created_at ?? null}
          onLongPress={handleLongPress}
          onReactionPress={handleReact}
          onOpenThread={setThreadMsg}
          currentUserId={user?.id ?? ''}
        />
      );
    },
    [messages, user?.id, isGroup]
  );

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={26} color="#1a1a1a" />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerName} numberOfLines={1}>{displayName}</Text>
          {isGroup ? (
            <Text style={styles.headerSub}>
              {convo?.members.length ?? 0} members
            </Text>
          ) : null}
        </View>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        {/* Messages */}
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          renderItem={renderItem}
          contentContainerStyle={styles.messageList}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          ListEmptyComponent={
            <View style={styles.emptyChat}>
              <Ionicons name="chatbubble-outline" size={40} color="#e0e0e0" />
              <Text style={styles.emptyChatText}>No messages yet. Say hello!</Text>
            </View>
          }
        />

        {/* Reply banner */}
        {replyTo ? (
          <View style={styles.replyBanner}>
            <Ionicons name="return-down-back-outline" size={16} color="#D85A30" />
            <Text style={styles.replyBannerText} numberOfLines={1}>
              Replying to: {replyTo.content}
            </Text>
            <Pressable onPress={() => setReplyTo(null)} hitSlop={8}>
              <Ionicons name="close" size={18} color="#888" />
            </Pressable>
          </View>
        ) : null}

        {/* Input bar */}
        <View style={[styles.inputBar, { paddingBottom: insets.bottom + 8 }]}>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder="Message…"
            placeholderTextColor="#aaa"
            multiline
            maxLength={2000}
            returnKeyType="default"
          />
          <Pressable
            onPress={handleSend}
            disabled={!draft.trim() || sendMessage.isPending}
            style={[styles.sendBtn, !draft.trim() && styles.sendBtnDisabled]}
            accessibilityRole="button"
            accessibilityLabel="Send"
          >
            <Ionicons name="arrow-up" size={18} color="#fff" />
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      {/* Long-press context menu */}
      <ContextMenu
        visible={!!contextMsg}
        isMe={contextMsg?.sender_id === user?.id}
        message={contextMsg}
        onReact={(emoji) => {
          if (!contextMsg) return;
          const alreadyReacted = contextMsg.reactions.some(
            (r) => r.emoji === emoji && r.profile_id === user?.id
          );
          handleReact(contextMsg.id, emoji, alreadyReacted);
        }}
        onReply={() => contextMsg && setReplyTo(contextMsg)}
        onReplyInThread={() => contextMsg && setThreadMsg(contextMsg)}
        onDelete={handleDelete}
        onClose={() => setContextMsg(null)}
      />

      {/* Thread panel — slides up as a modal */}
      <Modal
        visible={!!threadMsg}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setThreadMsg(null)}
      >
        {threadMsg ? (
          <ThreadPanel
            parentMsg={threadMsg}
            conversationId={conversationId}
            currentUserId={user?.id ?? ''}
            isGroup={!!isGroup}
            onClose={() => setThreadMsg(null)}
          />
        ) : null}
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e8e8e8',
    backgroundColor: '#fff',
  },
  backBtn: { width: 40, alignItems: 'center' },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerName: { fontSize: 16, fontWeight: '700', color: '#1a1a1a' },
  headerSub: { fontSize: 12, color: '#888', marginTop: 1 },

  messageList: { paddingHorizontal: 12, paddingTop: 12, paddingBottom: 8 },

  dateDivider: { alignItems: 'center', marginVertical: 12 },
  dateDividerText: { fontSize: 11, color: '#aaa', fontWeight: '500' },

  messageRow: {
    flexDirection: 'row',
    marginBottom: 4,
    gap: 6,
  },
  messageRowMe: { flexDirection: 'row-reverse' },

  miniAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniAvatarText: { color: '#fff', fontSize: 10, fontWeight: '700' },

  bubbleCol: { maxWidth: '72%', alignItems: 'flex-start' },
  bubbleColMe: { alignItems: 'flex-end' },

  senderName: { fontSize: 12, fontWeight: '600', color: '#888', marginBottom: 3, marginLeft: 2 },
  senderNameMe: { marginLeft: 0, marginRight: 2, textAlign: 'right' },

  replySnippet: {
    backgroundColor: '#f5f5f5',
    borderLeftWidth: 3,
    borderLeftColor: '#D85A30',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginBottom: 3,
    maxWidth: '100%',
  },
  replySnippetMe: { borderLeftColor: 'rgba(255,255,255,0.7)', backgroundColor: 'rgba(255,255,255,0.2)' },
  replyText: { fontSize: 12, color: '#666' },

  bubble: {
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 9,
    maxWidth: '100%',
  },
  bubbleThem: {
    backgroundColor: '#f0f0f0',
    borderBottomLeftRadius: 4,
  },
  bubbleMe: {
    backgroundColor: '#D85A30',
    borderBottomRightRadius: 4,
  },
  bubbleText: { fontSize: 15, color: '#1a1a1a', lineHeight: 20, fontFamily: undefined },
  bubbleTextMe: { color: '#fff' },

  timestamp: { fontSize: 11, color: '#bbb', marginTop: 3, marginLeft: 4 },
  timestampMe: { marginLeft: 0, marginRight: 4 },

  reactions: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4, marginLeft: 2 },
  reactionsMe: { justifyContent: 'flex-end', marginLeft: 0, marginRight: 2 },
  reactionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#f5f5f5',
    borderRadius: 12,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: '#e8e8e8',
  },
  reactionPillMine: { borderColor: '#D85A30', backgroundColor: '#fff5f2' },
  reactionEmoji: { fontSize: 14, fontFamily: undefined },
  reactionCount: { fontSize: 12, fontWeight: '600', color: '#888' },

  threadBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 5,
    marginLeft: 2,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    backgroundColor: '#fff5f2',
    borderWidth: 1,
    borderColor: '#f5cfc5',
    alignSelf: 'flex-start',
  },
  threadBadgeMe: { alignSelf: 'flex-end', marginLeft: 0, marginRight: 2 },
  threadBadgeText: { fontSize: 12, fontWeight: '600', color: '#D85A30' },

  replyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e8e8e8',
    backgroundColor: '#fafafa',
  },
  replyBannerText: { flex: 1, fontSize: 13, color: '#555' },

  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e8e8e8',
    backgroundColor: '#fff',
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
    fontSize: 15,
    color: '#1a1a1a',
    backgroundColor: '#fafafa',
  },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#D85A30',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  sendBtnDisabled: { backgroundColor: '#e0e0e0' },

  menuOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  menuCard: {
    backgroundColor: '#fff',
    borderRadius: 20,
    width: '100%',
    maxWidth: 340,
    overflow: 'hidden',
  },
  menuPreview: {
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f0f0f0',
    backgroundColor: '#fafafa',
  },
  menuPreviewText: { fontSize: 14, color: '#444', lineHeight: 20 },
  emojiTray: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 14,
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f0f0f0',
  },
  emojiBtn: { padding: 4 },
  emojiText: { fontSize: 26, fontFamily: undefined },
  menuActions: { paddingVertical: 4 },
  menuAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#f0f0f0',
  },
  menuActionDestructive: {},
  menuActionText: { fontSize: 15, fontWeight: '500', color: '#1a1a1a' },

  emptyChat: { alignItems: 'center', paddingTop: 80, gap: 10 },
  emptyChatText: { fontSize: 14, color: '#bbb' },

  // ─── Thread panel ───────────────────────────────────────────────────────────
  threadPanel: { flex: 1, backgroundColor: '#fff' },
  threadHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e8e8e8',
  },
  threadHeaderTitle: { fontSize: 16, fontWeight: '700', color: '#1a1a1a' },
  threadCloseBtn: { position: 'absolute', right: 16 },

  threadList: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 8 },

  threadParentWrapper: {
    paddingBottom: 12,
  },

  threadDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginVertical: 12,
  },
  threadDividerLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: '#e0e0e0' },
  threadDividerLabel: { fontSize: 11, color: '#aaa', fontWeight: '500' },

  threadEmptyReplies: { alignItems: 'center', paddingVertical: 24 },
  threadEmptyText: { fontSize: 13, color: '#bbb' },
});
