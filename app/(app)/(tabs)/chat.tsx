/**
 * Messages home — list of all DM and group conversations.
 * Instagram DM-style layout: avatar, name, last message preview, timestamp.
 */
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '@/stores/authStore';
import {
  useConversationRealtime,
  useConversations,
} from '@/hooks/useConversations';
import type { ConversationWithPreview } from '@/types/database';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function initials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0] ?? '')
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

const AVATAR_COLORS = ['#D85A30', '#235C38', '#1A4060', '#7C3AED', '#0891B2', '#BE185D'];
function avatarColor(id: string): string {
  let n = 0;
  for (let i = 0; i < id.length; i++) n += id.charCodeAt(i);
  return AVATAR_COLORS[n % AVATAR_COLORS.length];
}

// ─── Avatar ───────────────────────────────────────────────────────────────────

function Avatar({ name, id, size = 52 }: { name: string; id: string; size?: number }) {
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2, backgroundColor: avatarColor(id) }]}>
      <Text style={[styles.avatarText, { fontSize: size * 0.35 }]}>{initials(name)}</Text>
    </View>
  );
}

// ─── Conversation row ─────────────────────────────────────────────────────────

function ConversationRow({
  convo,
  currentUserId,
  onPress,
}: {
  convo: ConversationWithPreview;
  currentUserId: string;
  onPress: () => void;
}) {
  const displayName =
    convo.type === 'dm'
      ? convo.members.find((m) => m.profile_id !== currentUserId)?.profile.name ?? 'Unknown'
      : convo.name ?? 'Group chat';

  const lastMsgSenderName =
    convo.lastMessage?.sender_id === currentUserId
      ? 'You'
      : convo.members.find((m) => m.profile_id === convo.lastMessage?.sender_id)?.profile.name?.split(' ')[0] ?? '';

  const preview = convo.lastMessage
    ? convo.type === 'group'
      ? `${lastMsgSenderName}: ${convo.lastMessage.content}`
      : convo.lastMessage.sender_id === currentUserId
        ? `You: ${convo.lastMessage.content}`
        : convo.lastMessage.content
    : 'No messages yet';

  const hasUnread = convo.unreadCount > 0;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: '#f5f5f5' }]}
      accessibilityRole="button"
    >
      <View>
        <Avatar name={displayName} id={convo.id} />
        {hasUnread ? <View style={styles.unreadDot} /> : null}
      </View>

      <View style={styles.rowContent}>
        <View style={styles.rowTop}>
          <Text style={[styles.rowName, hasUnread && styles.rowNameBold]} numberOfLines={1}>
            {displayName}
          </Text>
          {convo.lastMessage ? (
            <Text style={[styles.rowTime, hasUnread && styles.rowTimeBold]}>
              {relativeTime(convo.lastMessage.created_at)}
            </Text>
          ) : null}
        </View>
        <Text style={[styles.rowPreview, hasUnread && styles.rowPreviewBold]} numberOfLines={1}>
          {preview}
        </Text>
      </View>
    </Pressable>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function MessagesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuthStore();
  const [search, setSearch] = useState('');

  const { data: conversations = [], isLoading, refetch } = useConversations();
  useConversationRealtime();

  const filtered = conversations.filter((c) => {
    if (!search.trim()) return true;
    const name =
      c.type === 'dm'
        ? c.members.find((m) => m.profile_id !== user?.id)?.profile.name ?? ''
        : c.name ?? '';
    return name.toLowerCase().includes(search.toLowerCase());
  });

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Messages</Text>
        <Pressable
          onPress={() => router.push('/(app)/chat/new')}
          style={styles.composeBtn}
          accessibilityRole="button"
          accessibilityLabel="New message"
          hitSlop={8}
        >
          <Ionicons name="create-outline" size={24} color="#1a1a1a" />
        </Pressable>
      </View>

      {/* Search */}
      <View style={styles.searchWrap}>
        <Ionicons name="search" size={15} color="#aaa" style={{ marginLeft: 10 }} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search"
          placeholderTextColor="#aaa"
          value={search}
          onChangeText={setSearch}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
      </View>

      {/* List */}
      <FlatList
        data={filtered}
        keyExtractor={(c) => c.id}
        renderItem={({ item }) => (
          <ConversationRow
            convo={item}
            currentUserId={user?.id ?? ''}
            onPress={() => router.push(`/(app)/chat/${item.id}`)}
          />
        )}
        ItemSeparatorComponent={() => (
          <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: '#f0f0f0', marginLeft: 80 }} />
        )}
        refreshControl={
          <RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor="#D85A30" />
        }
        ListEmptyComponent={
          !isLoading ? (
            <View style={styles.empty}>
              <Ionicons name="chatbubble-ellipses-outline" size={56} color="#e0e0e0" />
              <Text style={styles.emptyTitle}>No messages yet</Text>
              <Text style={styles.emptySub}>
                Tap the compose icon above to start a conversation with someone.
              </Text>
              <Pressable
                onPress={() => router.push('/(app)/chat/new')}
                style={styles.emptyBtn}
                accessibilityRole="button"
              >
                <Text style={styles.emptyBtnText}>Send a message</Text>
              </Pressable>
            </View>
          ) : null
        }
        contentContainerStyle={filtered.length === 0 ? { flex: 1 } : { paddingBottom: insets.bottom + 16 }}
        keyboardShouldPersistTaps="handled"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 4,
    paddingBottom: 12,
  },
  headerTitle: { fontSize: 22, fontWeight: '700', color: '#1a1a1a' },
  composeBtn: { padding: 4 },

  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 14,
    marginBottom: 8,
    backgroundColor: '#f0f0f0',
    borderRadius: 12,
    height: 38,
    gap: 4,
  },
  searchInput: { flex: 1, fontSize: 15, color: '#1a1a1a', paddingRight: 10 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 12,
    backgroundColor: '#fff',
  },
  avatar: { alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontWeight: '700' },
  unreadDot: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 13,
    height: 13,
    borderRadius: 7,
    backgroundColor: '#D85A30',
    borderWidth: 2,
    borderColor: '#fff',
  },
  rowContent: { flex: 1 },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 3,
  },
  rowName: { fontSize: 15, fontWeight: '500', color: '#1a1a1a', flex: 1, marginRight: 8 },
  rowNameBold: { fontWeight: '700' },
  rowTime: { fontSize: 12, color: '#aaa' },
  rowTimeBold: { color: '#D85A30', fontWeight: '600' },
  rowPreview: { fontSize: 13, color: '#888' },
  rowPreviewBold: { color: '#1a1a1a', fontWeight: '600' },

  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 40,
  },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#1a1a1a', marginTop: 4 },
  emptySub: { fontSize: 14, color: '#888', textAlign: 'center', lineHeight: 20 },
  emptyBtn: {
    marginTop: 6,
    backgroundColor: '#D85A30',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
  },
  emptyBtnText: { fontSize: 15, fontWeight: '600', color: '#fff' },
});
