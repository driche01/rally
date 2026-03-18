import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCreateGroupConversation, useGetOrCreateDM, useProfileSearch } from '@/hooks/useConversations';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SelectedProfile {
  id: string;
  name: string;
  initials: string;
  color: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

const AVATAR_COLORS = [
  '#D85A30', '#235C38', '#1A4060', '#7C3AED', '#B45309',
  '#0E7490', '#BE185D', '#166534', '#9333EA', '#C2410C',
];

function hashColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Avatar({ name, id, size = 40 }: { name: string; id: string; size?: number }) {
  return (
    <View
      style={[
        styles.avatar,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: hashColor(id) },
      ]}
    >
      <Text style={[styles.avatarText, { fontSize: size * 0.38 }]}>{getInitials(name)}</Text>
    </View>
  );
}

function SelectedChip({ profile, onRemove }: { profile: SelectedProfile; onRemove: () => void }) {
  return (
    <View style={styles.chip}>
      <Text style={styles.chipText}>{profile.name.split(' ')[0]}</Text>
      <Pressable onPress={onRemove} hitSlop={6} style={styles.chipRemove}>
        <Ionicons name="close" size={12} color="#fff" />
      </Pressable>
    </View>
  );
}

function ProfileRow({
  profile,
  selected,
  onToggle,
}: {
  profile: { id: string; full_name: string | null; username: string | null };
  selected: boolean;
  onToggle: () => void;
}) {
  const name = profile.full_name || profile.username || 'Unknown';
  const sub = profile.username ? `@${profile.username}` : null;

  return (
    <TouchableOpacity style={styles.row} onPress={onToggle} activeOpacity={0.7}>
      <Avatar name={name} id={profile.id} size={44} />
      <View style={styles.rowMeta}>
        <Text style={styles.rowName} numberOfLines={1}>{name}</Text>
        {sub ? <Text style={styles.rowSub} numberOfLines={1}>{sub}</Text> : null}
      </View>
      <View style={[styles.checkCircle, selected && styles.checkCircleSelected]}>
        {selected && <Ionicons name="checkmark" size={14} color="#fff" />}
      </View>
    </TouchableOpacity>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function NewMessageScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const searchRef = useRef<TextInput>(null);

  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<SelectedProfile[]>([]);
  const [groupName, setGroupName] = useState('');

  const { data: results = [], isFetching } = useProfileSearch(query);

  const getDM = useGetOrCreateDM();
  const createGroup = useCreateGroupConversation();

  const isGroup = selected.length > 1;
  const canStart = selected.length > 0 && (!isGroup || groupName.trim().length > 0);

  // Focus search on mount
  useEffect(() => {
    const t = setTimeout(() => searchRef.current?.focus(), 150);
    return () => clearTimeout(t);
  }, []);

  function toggleProfile(p: { id: string; full_name: string | null; username: string | null }) {
    const name = p.full_name || p.username || 'Unknown';
    setSelected((prev) => {
      const exists = prev.find((s) => s.id === p.id);
      if (exists) return prev.filter((s) => s.id !== p.id);
      return [...prev, { id: p.id, name, initials: getInitials(name), color: hashColor(p.id) }];
    });
  }

  function removeSelected(id: string) {
    setSelected((prev) => prev.filter((s) => s.id !== id));
  }

  function handleStart() {
    if (!canStart) return;
    if (isGroup) {
      createGroup.mutate(
        { name: groupName.trim(), memberIds: selected.map((s) => s.id) },
        {
          onSuccess: (conversation) => {
            router.replace(`/(app)/chat/${conversation.id}`);
          },
        }
      );
    } else {
      getDM.mutate(selected[0].id, {
        onSuccess: (conversation) => {
          router.replace(`/(app)/chat/${conversation.id}`);
        },
      });
    }
  }

  const selectedIds = new Set(selected.map((s) => s.id));
  const isLoading = getDM.isPending || createGroup.isPending;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: '#fff' }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}
    >
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={26} color="#262626" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>New message</Text>
        <TouchableOpacity
          onPress={handleStart}
          disabled={!canStart || isLoading}
          style={[styles.startBtn, (!canStart || isLoading) && styles.startBtnDisabled]}
        >
          {isLoading ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.startBtnText}>{isGroup ? 'Create group' : 'Message'}</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* To field */}
      <View style={styles.toRow}>
        <Text style={styles.toLabel}>To:</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chipsScroll}
          contentContainerStyle={styles.chipsContent}
          keyboardShouldPersistTaps="handled"
        >
          {selected.map((p) => (
            <SelectedChip key={p.id} profile={p} onRemove={() => removeSelected(p.id)} />
          ))}
          <TextInput
            ref={searchRef}
            style={styles.toInput}
            value={query}
            onChangeText={setQuery}
            placeholder={selected.length === 0 ? 'Search people…' : ''}
            placeholderTextColor="#a3a3a3"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
        </ScrollView>
      </View>

      {/* Group name field (shown when 2+ selected) */}
      {isGroup && (
        <View style={styles.groupNameRow}>
          <Ionicons name="people-outline" size={18} color="#737373" style={{ marginRight: 8 }} />
          <TextInput
            style={styles.groupNameInput}
            value={groupName}
            onChangeText={setGroupName}
            placeholder="Group name (required)"
            placeholderTextColor="#a3a3a3"
            autoCapitalize="words"
            returnKeyType="done"
          />
        </View>
      )}

      <View style={styles.divider} />

      {/* Suggested / search results */}
      {isFetching && query.length > 0 ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="small" color="#D85A30" />
        </View>
      ) : results.length > 0 ? (
        <FlatList
          data={results}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <ProfileRow
              profile={item}
              selected={selectedIds.has(item.id)}
              onToggle={() => toggleProfile(item)}
            />
          )}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        />
      ) : query.trim().length === 0 ? (
        <View style={styles.emptyWrap}>
          <Ionicons name="search-outline" size={40} color="#d4d4d4" />
          <Text style={styles.emptyTitle}>Search for people</Text>
          <Text style={styles.emptyBody}>
            Type a name or username to find someone to message.
          </Text>
        </View>
      ) : (
        <View style={styles.emptyWrap}>
          <Ionicons name="person-outline" size={40} color="#d4d4d4" />
          <Text style={styles.emptyTitle}>No results</Text>
          <Text style={styles.emptyBody}>No people matched "{query}".</Text>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: '#fff',
  },
  backBtn: { padding: 4 },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '700',
    color: '#262626',
    marginHorizontal: 8,
  },
  startBtn: {
    backgroundColor: '#D85A30',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    minWidth: 80,
    alignItems: 'center',
  },
  startBtnDisabled: { backgroundColor: '#e5e5e5' },
  startBtnText: { fontSize: 14, fontWeight: '600', color: '#fff' },

  toRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    minHeight: 48,
  },
  toLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#262626',
    marginRight: 8,
  },
  chipsScroll: { flex: 1 },
  chipsContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'nowrap',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#D85A30',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
    gap: 4,
  },
  chipText: { fontSize: 13, fontWeight: '600', color: '#fff' },
  chipRemove: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  toInput: {
    fontSize: 15,
    color: '#262626',
    minWidth: 120,
    height: 32,
    padding: 0,
  },

  groupNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e5e5e5',
  },
  groupNameInput: {
    flex: 1,
    fontSize: 15,
    color: '#262626',
    height: 32,
    padding: 0,
  },

  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#e5e5e5',
    marginTop: 4,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 12,
  },
  avatar: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#fff',
    fontWeight: '700',
  },
  rowMeta: { flex: 1, gap: 1 },
  rowName: { fontSize: 15, fontWeight: '600', color: '#262626' },
  rowSub: { fontSize: 13, color: '#737373' },
  checkCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#d4d4d4',
    backgroundColor: '#fafafa',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkCircleSelected: {
    backgroundColor: '#D85A30',
    borderColor: '#D85A30',
  },

  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 60,
  },
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    paddingBottom: 80,
    gap: 8,
  },
  emptyTitle: { fontSize: 16, fontWeight: '600', color: '#404040', marginTop: 8 },
  emptyBody: { fontSize: 14, color: '#a3a3a3', textAlign: 'center', lineHeight: 20 },
});
