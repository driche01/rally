/**
 * ChatTab — F8 Group Broadcast + Chat
 * Real-time group messaging with reactions, pins, and itinerary block attachments.
 */
import { useState, useRef, useCallback, useMemo } from 'react';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  useMessages,
  useMessageRealtime,
  useSendMessage,
  useDeleteMessage,
  useSetPinned,
  useAddReaction,
  useRemoveReaction,
} from '@/hooks/useMessages';
import { useItineraryBlocks } from '@/hooks/useItinerary';
import { groupReactions } from '@/lib/api/messages';
import { formatDayLabel } from '@/lib/api/itinerary';
import { useAuthStore } from '@/stores/authStore';
import type { TripMessageWithReactions, ItineraryBlock, BlockType } from '@/types/database';

// ─── Constants ────────────────────────────────────────────────────────────────

const REACTION_EMOJIS = ['👍', '❤️', '😂', '🙌', '🔥', '✈️'];

const BLOCK_TYPE_ICONS: Record<BlockType, React.ComponentProps<typeof Ionicons>['name']> = {
  activity: 'bicycle-outline',
  meal: 'restaurant-outline',
  travel: 'car-outline',
  accommodation: 'bed-outline',
  free_time: 'sunny-outline',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;

  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(diff / 3_600_000);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(diff / 86_400_000);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;

  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ─── Attached block preview ───────────────────────────────────────────────────

function BlockAttachmentPreview({
  block,
  onRemove,
}: {
  block: ItineraryBlock;
  onRemove?: () => void;
}) {
  const icon = BLOCK_TYPE_ICONS[block.type];
  return (
    <View
      className="flex-row items-center gap-2 rounded-xl border border-coral-500 bg-coral-50 px-3 py-2"
    >
      <Ionicons name={icon} size={14} color="#D85A30" />
      <View className="flex-1">
        <Text className="text-xs font-semibold text-coral-700" numberOfLines={1}>
          {block.title}
        </Text>
        <Text className="text-xs text-coral-500">{formatDayLabel(block.day_date)}</Text>
      </View>
      {onRemove ? (
        <Pressable onPress={onRemove} className="p-0.5">
          <Ionicons name="close" size={14} color="#D85A30" />
        </Pressable>
      ) : null}
    </View>
  );
}

// ─── Reaction picker overlay ──────────────────────────────────────────────────

function ReactionPicker({
  visible,
  onSelect,
  onClose,
}: {
  visible: boolean;
  onSelect: (emoji: string) => void;
  onClose: () => void;
}) {
  if (!visible) return null;

  return (
    <Pressable
      style={{
        position: 'absolute',
        top: 0, left: 0, right: 0, bottom: 0,
        zIndex: 100,
      }}
      onPress={onClose}
    >
      <View
        style={{
          position: 'absolute',
          bottom: 8,
          left: 8,
          right: 8,
          backgroundColor: 'white',
          borderRadius: 20,
          padding: 12,
          flexDirection: 'row',
          justifyContent: 'space-around',
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.12,
          shadowRadius: 16,
          elevation: 8,
        }}
      >
        {REACTION_EMOJIS.map((emoji) => (
          <Pressable
            key={emoji}
            onPress={() => { onSelect(emoji); }}
            style={{ padding: 6 }}
          >
            <Text style={{ fontSize: 24 }}>{emoji}</Text>
          </Pressable>
        ))}
      </View>
    </Pressable>
  );
}

// ─── Block picker sheet ───────────────────────────────────────────────────────

function BlockPickerSheet({
  visible,
  blocks,
  onSelect,
  onClose,
}: {
  visible: boolean;
  blocks: ItineraryBlock[];
  onSelect: (block: ItineraryBlock) => void;
  onClose: () => void;
}) {
  // Group blocks by day_date
  const grouped = useMemo(() => {
    const map = new Map<string, ItineraryBlock[]>();
    for (const b of blocks) {
      const arr = map.get(b.day_date) ?? [];
      arr.push(b);
      map.set(b.day_date, arr);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [blocks]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}
        onPress={onClose}
      >
        <Pressable
          onPress={() => {}}
          style={{ backgroundColor: 'white', borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '70%' }}
        >
          <View style={{ alignItems: 'center', paddingTop: 12, paddingBottom: 8 }}>
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: '#E5E5E5' }} />
          </View>
          <Text style={{ fontSize: 16, fontWeight: '700', color: '#1C1C1C', paddingHorizontal: 20, paddingBottom: 12 }}>
            Attach a block
          </Text>

          {blocks.length === 0 ? (
            <View style={{ alignItems: 'center', padding: 32 }}>
              <Text style={{ fontSize: 14, color: '#A3A3A3', textAlign: 'center' }}>
                No itinerary blocks yet. Add blocks in the Itinerary tab.
              </Text>
            </View>
          ) : (
            <ScrollView
              style={{ paddingHorizontal: 20 }}
              contentContainerStyle={{ paddingBottom: 32 }}
              showsVerticalScrollIndicator={false}
            >
              {grouped.map(([date, dayBlocks]) => (
                <View key={date} style={{ marginBottom: 16 }}>
                  <Text style={{ fontSize: 12, fontWeight: '700', color: '#737373', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    {formatDayLabel(date)}
                  </Text>
                  {dayBlocks.map((block) => {
                    const icon = BLOCK_TYPE_ICONS[block.type];
                    return (
                      <Pressable
                        key={block.id}
                        onPress={() => { onSelect(block); onClose(); }}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 10,
                          paddingVertical: 10,
                          paddingHorizontal: 12,
                          borderRadius: 14,
                          marginBottom: 6,
                          backgroundColor: '#FAFAFA',
                          borderWidth: 1,
                          borderColor: '#F0F0F0',
                        }}
                      >
                        <Ionicons name={icon} size={16} color="#D85A30" />
                        <Text style={{ fontSize: 14, fontWeight: '500', color: '#1C1C1C' }} numberOfLines={1}>
                          {block.title}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              ))}
            </ScrollView>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ─── Message item ─────────────────────────────────────────────────────────────

function MessageItem({
  message,
  isOwn,
  userId,
  attachedBlock,
  onLongPress,
  onToggleReaction,
  onShowReactionPicker,
}: {
  message: TripMessageWithReactions;
  isOwn: boolean;
  userId: string;
  attachedBlock: ItineraryBlock | undefined;
  onLongPress: () => void;
  onToggleReaction: (emoji: string) => void;
  onShowReactionPicker: () => void;
}) {
  const grouped = useMemo(() => groupReactions(message.reactions), [message.reactions]);
  const time = formatRelativeTime(message.created_at);

  return (
    <Pressable onLongPress={onLongPress} className="mb-3 px-4">
      <View className={`max-w-[85%] ${isOwn ? 'self-end' : 'self-start'}`}>
        {/* Sender label */}
        {!isOwn ? (
          <Text className="mb-1 ml-1 text-xs font-semibold text-neutral-500">
            {message.senderProfile?.name ?? 'You'}
          </Text>
        ) : null}

        {/* Attached block */}
        {attachedBlock ? (
          <View className="mb-1.5">
            <BlockAttachmentPreview block={attachedBlock} />
          </View>
        ) : null}

        {/* Bubble */}
        <View
          className={`rounded-2xl px-4 py-3 ${
            isOwn ? 'rounded-tr-md bg-coral-500' : 'rounded-tl-md bg-white'
          }`}
          style={
            isOwn
              ? undefined
              : { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 1 }
          }
        >
          <Text className={`text-sm leading-5 ${isOwn ? 'text-white' : 'text-neutral-800'}`}>
            {message.content}
          </Text>
        </View>

        {/* Reactions + meta */}
        <View className={`mt-1 flex-row items-center gap-2 ${isOwn ? 'flex-row-reverse' : 'flex-row'}`}>
          {/* Reaction pills */}
          {grouped.length > 0 ? (
            <View className="flex-row flex-wrap gap-1">
              {grouped.map(({ emoji, count, reactorIds }) => {
                const reacted = reactorIds.includes(userId);
                return (
                  <Pressable
                    key={emoji}
                    onPress={() => onToggleReaction(emoji)}
                    className={`flex-row items-center gap-1 rounded-full px-2 py-0.5 ${reacted ? 'bg-coral-100' : 'bg-neutral-100'}`}
                  >
                    <Text style={{ fontSize: 12 }}>{emoji}</Text>
                    <Text className={`text-xs font-medium ${reacted ? 'text-coral-600' : 'text-neutral-500'}`}>
                      {count}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}

          {/* Add reaction button */}
          <Pressable onPress={onShowReactionPicker} className="p-0.5">
            <Ionicons name="add-circle-outline" size={16} color="#D4D4D4" />
          </Pressable>

          {/* Timestamp */}
          <Text className="text-xs text-neutral-400">{time}</Text>

          {/* Read count */}
          {message.read_count > 0 ? (
            <Text className="text-xs text-neutral-300">
              Seen by {message.read_count}
            </Text>
          ) : null}

          {/* Pinned indicator */}
          {message.is_pinned ? (
            <Ionicons name="pin" size={12} color="#D85A30" />
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

// ─── Pinned bar ───────────────────────────────────────────────────────────────

function PinnedBar({ messages }: { messages: TripMessageWithReactions[] }) {
  const [expanded, setExpanded] = useState(false);
  const pinned = messages.filter((m) => m.is_pinned);

  if (pinned.length === 0) return null;

  const preview = pinned.slice(0, 3);

  return (
    <View className="border-b border-neutral-100 bg-neutral-50 px-4 py-2">
      <Pressable
        onPress={() => setExpanded((p) => !p)}
        className="flex-row items-center gap-2"
      >
        <Ionicons name="pin" size={13} color="#D85A30" />
        <Text className="flex-1 text-xs font-semibold text-neutral-600">
          {pinned.length} pinned {pinned.length === 1 ? 'message' : 'messages'}
        </Text>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={13}
          color="#A3A3A3"
        />
      </Pressable>

      {expanded ? (
        <View className="mt-2 gap-1.5">
          {preview.map((m) => (
            <View key={m.id} className="rounded-xl bg-white px-3 py-2">
              <Text className="text-xs text-neutral-600" numberOfLines={2}>
                {m.content}
              </Text>
              <Text className="mt-0.5 text-xs text-neutral-400">
                {formatRelativeTime(m.created_at)}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function ChatTab({ tripId }: { tripId: string }) {
  const insets = useSafeAreaInsets();
  const user = useAuthStore((s) => s.user);
  const userId = user?.id ?? '';

  const { data: messages = [] } = useMessages(tripId);
  useMessageRealtime(tripId);

  const { data: blocks = [] } = useItineraryBlocks(tripId);

  const sendMessage = useSendMessage(tripId);
  const deleteMessage = useDeleteMessage(tripId);
  const setPinned = useSetPinned(tripId);
  const addReaction = useAddReaction(tripId);
  const removeReaction = useRemoveReaction(tripId);

  const [draft, setDraft] = useState('');
  const [attachedBlock, setAttachedBlock] = useState<ItineraryBlock | null>(null);
  const [blockPickerVisible, setBlockPickerVisible] = useState(false);
  const [reactionPickerFor, setReactionPickerFor] = useState<string | null>(null);

  const listRef = useRef<FlatList>(null);

  const canSend = draft.trim().length > 0;

  function handleSend() {
    if (!canSend) return;
    const content = draft.trim();
    const blockId = attachedBlock?.id ?? null;

    sendMessage.mutate(
      { content, itineraryBlockId: blockId },
      {
        onSuccess: () => {
          setDraft('');
          setAttachedBlock(null);
          setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
        },
        onError: () => Alert.alert('Error', 'Could not send message. Please try again.'),
      }
    );
  }

  const handleLongPress = useCallback(
    (message: TripMessageWithReactions) => {
      const isOwn = message.sender_id === userId;
      const isPinned = message.is_pinned;

      const options: { text: string; style?: 'cancel' | 'destructive'; onPress?: () => void }[] = [
        { text: 'Cancel', style: 'cancel' },
        {
          text: isPinned ? 'Unpin' : 'Pin',
          onPress: () =>
            setPinned.mutate(
              { messageId: message.id, isPinned: !isPinned },
              { onError: () => Alert.alert('Error', 'Could not update pin.') }
            ),
        },
      ];

      if (isOwn) {
        options.push({
          text: 'Delete',
          style: 'destructive',
          onPress: () =>
            Alert.alert('Delete message?', 'This cannot be undone.', [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Delete',
                style: 'destructive',
                onPress: () =>
                  deleteMessage.mutate(message.id, {
                    onError: () => Alert.alert('Error', 'Could not delete message.'),
                  }),
              },
            ]),
        });
      }

      Alert.alert('Message', undefined, options);
    },
    [userId, setPinned, deleteMessage]
  );

  function handleToggleReaction(messageId: string, emoji: string) {
    const message = messages.find((m) => m.id === messageId);
    if (!message) return;
    const alreadyReacted = message.reactions.some(
      (r) => r.reactor_id === userId && r.emoji === emoji
    );

    if (alreadyReacted) {
      removeReaction.mutate(
        { messageId, reactorId: userId, emoji },
        { onError: () => Alert.alert('Error', 'Could not remove reaction.') }
      );
    } else {
      addReaction.mutate(
        { messageId, reactorId: userId, reactorType: 'planner', emoji },
        { onError: () => Alert.alert('Error', 'Could not add reaction.') }
      );
    }
  }

  // Build a map of block id → block for attachment lookups
  const blockMap = useMemo(() => {
    const m = new Map<string, ItineraryBlock>();
    for (const b of blocks) m.set(b.id, b);
    return m;
  }, [blocks]);

  const renderMessage = useCallback(
    ({ item }: { item: TripMessageWithReactions }) => {
      const isOwn = item.sender_id === userId;
      const attached = item.itinerary_block_id
        ? blockMap.get(item.itinerary_block_id)
        : undefined;

      return (
        <MessageItem
          message={item}
          isOwn={isOwn}
          userId={userId}
          attachedBlock={attached}
          onLongPress={() => handleLongPress(item)}
          onToggleReaction={(emoji) => handleToggleReaction(item.id, emoji)}
          onShowReactionPicker={() => setReactionPickerFor(item.id)}
        />
      );
    },
    [userId, blockMap, handleLongPress]
  );

  return (
    <View className="flex-1 bg-neutral-50">
      {/* Pinned messages bar */}
      <PinnedBar messages={messages} />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        className="flex-1"
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        {/* Message list */}
        {messages.length === 0 ? (
          <View className="flex-1 items-center justify-center gap-3 px-8">
            <View className="h-14 w-14 items-center justify-center rounded-2xl bg-neutral-100">
              <Ionicons name="chatbubbles-outline" size={28} color="#A3A3A3" />
            </View>
            <Text className="text-base font-semibold text-neutral-700">No messages yet</Text>
            <Text className="text-center text-sm text-neutral-400">
              Send your group an update.
            </Text>
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(item) => item.id}
            renderItem={renderMessage}
            contentContainerStyle={{ paddingTop: 12, paddingBottom: 8 }}
            showsVerticalScrollIndicator={false}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
            keyboardDismissMode="on-drag"
          />
        )}

        {/* Reaction picker overlay */}
        {reactionPickerFor ? (
          <ReactionPicker
            visible={true}
            onSelect={(emoji) => {
              handleToggleReaction(reactionPickerFor, emoji);
              setReactionPickerFor(null);
            }}
            onClose={() => setReactionPickerFor(null)}
          />
        ) : null}

        {/* Compose area */}
        <View
          className="border-t border-neutral-100 bg-white px-4"
          style={{ paddingBottom: insets.bottom > 0 ? insets.bottom : 12, paddingTop: 8 }}
        >
          {/* Attached block preview */}
          {attachedBlock ? (
            <View className="mb-2">
              <BlockAttachmentPreview
                block={attachedBlock}
                onRemove={() => setAttachedBlock(null)}
              />
            </View>
          ) : null}

          <View className="flex-row items-end gap-2">
            {/* Block attachment button */}
            <Pressable
              onPress={() => setBlockPickerVisible(true)}
              className="mb-1 h-9 w-9 items-center justify-center rounded-xl bg-neutral-100 active:bg-neutral-200"
            >
              <Ionicons name="calendar-outline" size={18} color="#737373" />
            </Pressable>

            {/* Text input */}
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Message your group…"
              placeholderTextColor="#A3A3A3"
              multiline
              maxLength={1000}
              className="flex-1 rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-2.5 text-sm text-neutral-800"
              style={{ maxHeight: 120 }}
              returnKeyType="default"
            />

            {/* Send button */}
            <Pressable
              onPress={handleSend}
              disabled={!canSend || sendMessage.isPending}
              className={`mb-0.5 h-9 w-9 items-center justify-center rounded-xl ${canSend ? 'bg-coral-500' : 'bg-neutral-200'}`}
            >
              {sendMessage.isPending ? (
                <ActivityIndicator size="small" color="white" />
              ) : (
                <Ionicons name="send" size={16} color={canSend ? 'white' : '#A3A3A3'} />
              )}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>

      {/* Block picker sheet */}
      <BlockPickerSheet
        visible={blockPickerVisible}
        blocks={blocks}
        onSelect={setAttachedBlock}
        onClose={() => setBlockPickerVisible(false)}
      />
    </View>
  );
}
