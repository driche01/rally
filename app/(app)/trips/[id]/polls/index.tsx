import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Linking,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Badge, Button, Card } from '@/components/ui';
import { PreciseGroupSizeModal } from '@/components/PreciseGroupSizeModal';
import { usePolls, useUpdatePollStatus, useDecidePoll, useUndecidePoll, useDeletePoll, useDuplicatePoll, pollKeys } from '@/hooks/usePolls';
import { useRespondents, respondentKeys } from '@/hooks/useRespondents';
import { useResponseCounts, responseCountKeys } from '@/hooks/useResponseCounts';
import { useTrip, useUpdateTrip } from '@/hooks/useTrips';
import { usePermissions } from '@/hooks/usePermissions';
import { supabase } from '@/lib/supabase';
import { getShareUrl } from '@/lib/api/trips';
import { capture, Events } from '@/lib/analytics';
import { queryClient } from '@/lib/queryClient';
import { getTripStage, STAGE_ACCENT } from '@/lib/tripStage';
import { getParticipationRate, type GroupSizeBucket } from '@/types/database';
import type { PollWithOptions } from '@/types/database';

const SEASON_ICON: Record<string, React.ComponentProps<typeof Ionicons>['name']> = {
  Winter: 'snow-outline',
  Spring: 'flower-outline',
  Summer: 'sunny-outline',
  Fall: 'leaf-outline',
};

// ─── Poll result bar ───────────────────────────────────────────────────────────

function PollResultBar({
  label,
  votes,
  total,
  isLeading,
  isDecided,
  barColor,
}: {
  label: string;
  votes: number;
  total: number;
  isLeading: boolean;
  isDecided: boolean;
  barColor: string;
}) {
  const pct = total > 0 ? Math.round((votes / total) * 100) : 0;
  return (
    <View className="gap-1">
      <View className="flex-row items-center justify-between">
        <Text
          className={[
            'flex-1 text-sm',
            isLeading || isDecided ? 'font-semibold text-ink' : 'text-muted',
          ].join(' ')}
          numberOfLines={1}
        >
          {label}
          {isDecided ? '  ✓' : ''}
        </Text>
        <Text className="ml-2 text-sm text-muted">
          {votes} vote{votes !== 1 ? 's' : ''}
        </Text>
      </View>
      <View className="h-2 overflow-hidden rounded-full bg-cream-warm">
        <View
          className="h-full rounded-full bg-line"
          style={{ width: `${pct}%`, ...(isLeading || isDecided ? { backgroundColor: barColor } : {}) }}
        />
      </View>
    </View>
  );
}

// ─── Poll card ─────────────────────────────────────────────────────────────────

const PollCard = memo(function PollCard({
  poll,
  tripId,
  counts,
  groupSizeBucket,
  groupSizePrecise,
  router,
  canManagePolls,
  accentColor,
}: {
  poll: PollWithOptions;
  tripId: string;
  counts: Record<string, number>;
  groupSizeBucket?: GroupSizeBucket;
  groupSizePrecise?: number | null;
  router: ReturnType<typeof useRouter>;
  canManagePolls: boolean;
  accentColor: string;
}) {
  const updateStatus = useUpdatePollStatus(tripId);
  const decide = useDecidePoll(tripId);
  const undecide = useUndecidePoll(tripId);
  const deletePoll = useDeletePoll(tripId);
  const duplicate = useDuplicatePoll(tripId);

  const totalVotes = Object.values(counts).reduce((s, n) => s + n, 0);
  const hasResponses = totalVotes > 0;
  const leadingOptionId =
    totalVotes > 0
      ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0]
      : null;

  const statusBadge: Record<string, 'muted' | 'success' | 'default' | 'coral'> = {
    draft: 'muted',
    live: 'success',
    closed: 'default',
    decided: 'coral',
  };

  const mutationError = useCallback(
    (action: string) => () =>
      Alert.alert('Error', `Could not ${action}. Please try again.`),
    []
  );

  function handleGoLive() {
    Alert.alert(
      'Go live?',
      'Once this poll receives its first response it can no longer be edited — only closed or copied.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Go live',
          onPress: () =>
            updateStatus.mutate(
              { pollId: poll.id, status: 'live' },
              { onError: mutationError('go live') }
            ),
        },
      ]
    );
  }

  function handleClose() {
    updateStatus.mutate(
      { pollId: poll.id, status: 'closed' },
      {
        onSuccess: () => capture(Events.POLL_CLOSED, { poll_type: poll.type, trip_id: tripId }),
        onError: mutationError('close poll'),
      }
    );
  }

  function handleDecide(optionId: string, label: string) {
    if (poll.decided_option_id === optionId) return;
    const isChanging = poll.status === 'decided';
    Alert.alert(
      isChanging ? `Change decision to "${label}"?` : `Lock in "${label}"?`,
      isChanging ? 'This will replace the current decision.' : 'This marks the poll as decided.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: isChanging ? 'Change' : 'Decide',
          onPress: () => {
            decide.mutate(
              { pollId: poll.id, optionId },
              { onError: mutationError('save decision') }
            );
            capture(Events.POLL_DECIDED, { poll_type: poll.type, trip_id: tripId });
          },
        },
      ]
    );
  }

  function handleDelete() {
    Alert.alert('Delete this poll?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => deletePoll.mutate(poll.id, { onError: mutationError('delete poll') }),
      },
    ]);
  }

  function handleCopy() {
    Alert.alert(
      'Clone poll?',
      'Creates a new draft poll with the same question and options.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clone',
          onPress: () => duplicate.mutate(poll.id, { onError: mutationError('clone poll') }),
        },
      ]
    );
  }

  const isEditable = poll.status === 'draft' || (poll.status === 'live' && !hasResponses);
  const showCopy = hasResponses || poll.status === 'closed' || poll.status === 'decided';
  const decidedLabel = poll.decided_option_id
    ? poll.poll_options.find((o) => o.id === poll.decided_option_id)?.label
    : null;
  const statusLabel = poll.status.charAt(0).toUpperCase() + poll.status.slice(1);

  return (
    <Card className="mb-3">
      <View className="flex-row items-start justify-between gap-2">
        <View className="flex-1 gap-1.5">
          <Text className="text-base font-semibold text-ink">{poll.title}</Text>
          <Badge variant={statusBadge[poll.status] ?? 'default'}>
            {statusLabel}
          </Badge>
        </View>
        {canManagePolls ? (
          <View className="flex-row items-center gap-2">
            {isEditable && (
              <Pressable
                onPress={() => router.push(`/(app)/trips/${tripId}/polls/${poll.id}/edit`)}
                className="rounded-xl border border-line bg-card px-3 py-1.5"
                accessibilityRole="button"
              >
                <Text className="text-xs font-medium text-muted">Edit</Text>
              </Pressable>
            )}
            {poll.status === 'draft' && (
              <Pressable
                onPress={handleGoLive}
                className="rounded-xl px-3 py-1.5"
                style={{ backgroundColor: accentColor }}
                accessibilityRole="button"
              >
                <Text className="text-xs font-semibold text-white">Go live</Text>
              </Pressable>
            )}
            {poll.status === 'live' && (
              <Pressable
                onPress={handleClose}
                className="rounded-xl border border-line bg-card px-3 py-1.5"
                accessibilityRole="button"
              >
                <Text className="text-xs font-medium text-muted">Close</Text>
              </Pressable>
            )}
            {poll.status === 'decided' && (
              <Pressable
                onPress={() => undecide.mutate(poll.id, { onError: mutationError('undo decision') })}
                className="rounded-xl border border-line bg-card px-3 py-1.5"
                accessibilityRole="button"
              >
                <Text className="text-xs font-medium text-muted">Undo</Text>
              </Pressable>
            )}
            {showCopy && (
              <Pressable
                onPress={handleCopy}
                className="rounded-xl border border-line bg-card px-3 py-1.5"
                accessibilityRole="button"
              >
                <Text className="text-xs font-medium text-muted">Clone</Text>
              </Pressable>
            )}
            <Pressable onPress={handleDelete} className="p-1" accessibilityRole="button">
              <Ionicons name="trash-outline" size={16} color="#A8A8A8" />
            </Pressable>
          </View>
        ) : null}
      </View>

      {poll.status === 'decided' && decidedLabel ? (
        <View className="mt-3 rounded-xl px-3 py-2.5" style={{ backgroundColor: accentColor + '18' }}>
          <Text className="text-sm font-semibold" style={{ color: accentColor }}>✓ Decided: {decidedLabel}</Text>
        </View>
      ) : null}

      {poll.poll_options.length > 0 ? (
        <View className="mt-4 gap-3">
          {poll.poll_options.map((opt) => {
            const canDecide =
              canManagePolls && (
                poll.status === 'live' ||
                poll.status === 'closed' ||
                poll.status === 'decided'
              );
            return (
              <Pressable
                key={opt.id}
                onPress={canDecide ? () => handleDecide(opt.id, opt.label) : undefined}
                disabled={!canDecide}
              >
                <PollResultBar
                  label={opt.label}
                  votes={counts[opt.id] ?? 0}
                  total={totalVotes}
                  isLeading={leadingOptionId === opt.id}
                  isDecided={poll.decided_option_id === opt.id}
                  barColor={accentColor}
                />
              </Pressable>
            );
          })}
          {poll.status !== 'draft' ? (
            <View className="mt-1">
              {(() => {
                const participation = groupSizeBucket
                  ? getParticipationRate(totalVotes, groupSizeBucket, groupSizePrecise)
                  : null;
                return (
                  <>
                    {participation ? (
                      <>
                        <View className="h-1.5 overflow-hidden rounded-full bg-cream-warm">
                          <View
                            className="h-full rounded-full"
                            style={{ width: `${participation.percent}%`, backgroundColor: accentColor + 'AA' }}
                          />
                        </View>
                        <Text className="mt-1 text-xs text-muted">
                          {participation.count} of {participation.total} responded
                          {canManagePolls && (poll.status === 'live' || poll.status === 'closed')
                            ? '  ·  Tap an option to decide.'
                            : canManagePolls && poll.status === 'decided'
                              ? '  ·  Tap an option to change.'
                              : ''}
                        </Text>
                      </>
                    ) : (
                      <Text className="text-xs text-muted">
                        {totalVotes === 0
                          ? 'No responses yet.'
                          : `${totalVotes} response${totalVotes !== 1 ? 's' : ''}`}
                        {canManagePolls && (poll.status === 'live' || poll.status === 'closed')
                          ? '  ·  Tap an option to decide.'
                          : canManagePolls && poll.status === 'decided'
                            ? '  ·  Tap an option to change.'
                            : ''}
                      </Text>
                    )}
                  </>
                );
              })()}
            </View>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
});

// ─── Main screen ───────────────────────────────────────────────────────────────

export default function PollsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [sortNewest, setSortNewest] = useState(true);
  const [liveCollapsed, setLiveCollapsed] = useState(false);
  const [draftCollapsed, setDraftCollapsed] = useState(false);
  const [closedCollapsed, setClosedCollapsed] = useState(true);
  const [preciseModalVisible, setPreciseModalVisible] = useState(false);
  const [travelWindowModalVisible, setTravelWindowModalVisible] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState('');
  const nameInputRef = useRef<TextInput>(null);

  const mainScrollRef = useRef<ScrollView>(null);
  const [decidedSectionY, setDecidedSectionY] = useState(0);
  const [decidedCardYs, setDecidedCardYs] = useState<Record<string, number>>({});

  const { data: trip } = useTrip(id);
  const accentColor = STAGE_ACCENT[trip ? getTripStage(trip) : 'deciding'];
  const { canManagePolls } = usePermissions(id);
  const { data: polls = [], refetch: refetchPolls } = usePolls(id);
  const updateTrip = useUpdateTrip();
  const undecidePollMutation = useUndecidePoll(id);
  const { data: respondents = [] } = useRespondents(id);
  const { data: responseCounts = {}, refetch: refetchCounts } = useResponseCounts(id);

  const [refreshing, setRefreshing] = useState(false);
  async function handleRefresh() {
    setRefreshing(true);
    try {
      await Promise.all([refetchPolls(), refetchCounts()]);
    } finally {
      setRefreshing(false);
    }
  }

  const sortedPolls = useMemo(() => {
    return [...polls].sort((a, b) => {
      const diff = new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      return sortNewest ? diff : -diff;
    });
  }, [polls, sortNewest]);

  const pollIdString = useMemo(
    () => polls.map((p) => p.id).sort().join(','),
    [polls]
  );

  useEffect(() => {
    const pollIds = pollIdString ? pollIdString.split(',') : [];

    let builder = supabase
      .channel(`polls-screen:${id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'respondents', filter: `trip_id=eq.${id}` },
        () => queryClient.invalidateQueries({ queryKey: respondentKeys.forTrip(id) })
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'polls', filter: `trip_id=eq.${id}` },
        () => queryClient.invalidateQueries({ queryKey: pollKeys.forTrip(id) })
      );

    if (pollIds.length > 0) {
      builder = builder.on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'poll_responses',
          filter: `poll_id=in.(${pollIds.join(',')})`,
        },
        () => queryClient.invalidateQueries({ queryKey: responseCountKeys.forTrip(id) })
      );
    }

    const channel = builder.subscribe();
    return () => void supabase.removeChannel(channel);
  }, [id, pollIdString]);

  const handleShare = useCallback(() => {
    if (!trip) return;
    const url = getShareUrl(trip.share_token);
    const msg = `${trip.name} — help us decide! ${url}`;
    const encoded = encodeURIComponent(msg);

    Alert.alert('Share with group', 'Choose how to send:', [
      {
        text: 'Get Rally to run this in my group',
        onPress: () => {
          capture(Events.SHARE_LINK_COPIED, { trip_id: id, method: 'sms_session' });
          router.push(`/(app)/trips/${id}/activate-sms` as Parameters<typeof router.push>[0]);
        },
      },
      {
        text: 'iMessage / SMS',
        onPress: () => {
          const smsUrl = Platform.OS === 'ios' ? `sms:&body=${encoded}` : `sms:?body=${encoded}`;
          Linking.openURL(smsUrl);
          capture(Events.SHARE_LINK_COPIED, { trip_id: id, method: 'sms' });
        },
      },
      {
        text: 'WhatsApp',
        onPress: () => {
          Linking.openURL(`whatsapp://send?text=${encoded}`);
          capture(Events.SHARE_LINK_COPIED, { trip_id: id, method: 'whatsapp' });
        },
      },
      {
        text: 'More options…',
        onPress: async () => {
          try {
            await Share.share({ message: msg });
            capture(Events.SHARE_LINK_COPIED, { trip_id: id, method: 'native' });
          } catch {}
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [trip, id, router]);

  const handleCopyLink = useCallback(async () => {
    if (!trip) return;
    const url = getShareUrl(trip.share_token);
    await Clipboard.setStringAsync(url);
    capture(Events.SHARE_LINK_COPIED, { trip_id: id });
    Alert.alert('Copied!', 'Share link copied to clipboard.');
  }, [trip, id]);

  const hasLivePolls = useMemo(() => polls.some((p) => p.status === 'live'), [polls]);
  const livePolls = useMemo(() => sortedPolls.filter((p) => p.status === 'live'), [sortedPolls]);
  const draftPolls = useMemo(() => sortedPolls.filter((p) => p.status === 'draft'), [sortedPolls]);
  const closedPolls = useMemo(() => sortedPolls.filter((p) => p.status === 'closed'), [sortedPolls]);
  const decidedPolls = useMemo(() => sortedPolls.filter((p) => p.status === 'decided'), [sortedPolls]);

  return (
    <>
    <View className="flex-1 bg-cream" style={{ paddingTop: insets.top }}>

      {/* Sticky header */}
      <View className="px-6 pb-3 pt-4 border-b border-line bg-cream">
        <View className="flex-row items-center justify-between">
          <TouchableOpacity onPress={() => router.back()} accessibilityRole="button">
            <Text className="text-base" style={{ color: accentColor }}>← Back</Text>
          </TouchableOpacity>
          {canManagePolls && sortedPolls.length > 0 ? (
            <Pressable
              onPress={() => router.push(`/(app)/trips/${id}/polls/new`)}
              className="flex-row items-center gap-1 rounded-xl px-4 py-2"
              style={{ backgroundColor: accentColor }}
              accessibilityRole="button"
            >
              <Ionicons name="add" size={16} color="white" />
              <Text className="text-sm font-semibold text-white">Add poll</Text>
            </Pressable>
          ) : <View />}
        </View>

        {/* Trip name */}
        {canManagePolls && editingName ? (
          <TextInput
            ref={nameInputRef}
            value={nameValue}
            onChangeText={(t) => { if (t.length <= 60) setNameValue(t); }}
            maxLength={60}
            returnKeyType="done"
            onSubmitEditing={() => {
              const trimmed = nameValue.trim();
              if (trimmed && trip) updateTrip.mutate({ id: trip.id, name: trimmed });
              setEditingName(false);
            }}
            onBlur={() => {
              const trimmed = nameValue.trim();
              if (trimmed && trip) updateTrip.mutate({ id: trip.id, name: trimmed });
              setEditingName(false);
            }}
            className="mt-2 text-2xl font-bold text-ink rounded-xl bg-card px-3 py-2"
            style={{ borderWidth: 1, borderColor: '#E7DDCF' }}
          />
        ) : (
          <Pressable
            onPress={canManagePolls ? () => {
              setNameValue(trip?.name ?? '');
              setEditingName(true);
              setTimeout(() => nameInputRef.current?.focus(), 50);
            } : undefined}
            hitSlop={4}
          >
            <Text className="mt-2 text-2xl font-bold text-ink">{trip?.name ?? ''}</Text>
          </Pressable>
        )}

        <View className="mt-1 flex-row items-center gap-2">
          {trip?.travel_window
            ? trip.travel_window.split(', ').map((season) => (
                <Pressable
                  key={season}
                  onPress={canManagePolls ? () => setTravelWindowModalVisible(true) : undefined}
                  className="flex-row items-center gap-1 rounded-full border border-line bg-card px-2.5 py-1"
                  hitSlop={6}
                >
                  <Ionicons name={SEASON_ICON[season] ?? 'sunny-outline'} size={12} color="#737373" />
                  <Text className="text-xs text-muted">{season}</Text>
                </Pressable>
              ))
            : null}
          {trip ? (
            <Pressable
              onPress={canManagePolls ? () => setPreciseModalVisible(true) : undefined}
              className="flex-row items-center gap-1 rounded-full border border-line bg-card px-2.5 py-1"
              accessibilityRole="button"
              hitSlop={6}
            >
              <Ionicons name="people-outline" size={12} color="#737373" />
              <Text className="text-xs text-muted">
                {trip.group_size_precise != null
                  ? `${trip.group_size_precise} people`
                  : `${trip.group_size_bucket} people`}
              </Text>
            </Pressable>
          ) : null}
        </View>

        {/* Decided chips */}
        {decidedPolls.length > 0 ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8, paddingVertical: 2 }}>
            {decidedPolls.map((poll) => {
              const label = poll.poll_options.find((o) => o.id === poll.decided_option_id)?.label;
              if (!label) return null;
              return (
                <View key={poll.id} className="flex-row items-center gap-1 rounded-full border px-2.5 py-1" style={{ borderColor: accentColor + '50', backgroundColor: accentColor + '15' }}>
                  <Pressable
                    onPress={() => {
                      const y = decidedSectionY + (decidedCardYs[poll.id] ?? 0) - 8;
                      mainScrollRef.current?.scrollTo({ y: Math.max(0, y), animated: true });
                    }}
                    className="flex-row items-center gap-1"
                    accessibilityRole="button"
                  >
                    <Ionicons name="checkmark-circle" size={12} color={accentColor} />
                    <Text className="text-xs font-medium" style={{ color: accentColor }} numberOfLines={1}>
                      {label}
                    </Text>
                  </Pressable>
                  {canManagePolls ? (
                    <Pressable
                      onPress={() => undecidePollMutation.mutate(poll.id)}
                      hitSlop={6}
                      accessibilityRole="button"
                    >
                      <Ionicons name="refresh-outline" size={12} color={accentColor} style={{ transform: [{ scaleX: -1 }] }} />
                    </Pressable>
                  ) : null}
                </View>
              );
            })}
          </View>
        ) : null}

        {respondents.length > 0 ? (
          <Pressable
            onPress={() =>
              Alert.alert(
                `${respondents.length} respondent${respondents.length !== 1 ? 's' : ''}`,
                respondents.map((r) => `• ${r.name}`).join('\n')
              )
            }
            className="mt-2 flex-row items-center gap-1.5"
          >
            <Ionicons name="people-outline" size={14} color="#A8A8A8" />
            <Text className="text-xs text-muted">
              {respondents.slice(0, 3).map((r) => r.name).join(', ')}
              {respondents.length > 3 ? ` +${respondents.length - 3} more` : ''}
              {' · Tap to see all'}
            </Text>
          </Pressable>
        ) : null}

        {/* Share buttons */}
        <View className="mt-3 flex-row gap-2">
          <Button variant="secondary" onPress={handleShare} fullWidth className="flex-1">
            Share with group
          </Button>
          <Pressable
            onPress={handleCopyLink}
            className="items-center justify-center rounded-2xl border border-line bg-card px-4"
            style={{ elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 6 }}
            accessibilityRole="button"
            accessibilityLabel="Copy share link"
          >
            <Ionicons name="copy-outline" size={20} color="#4A4A4A" />
          </Pressable>
        </View>

        {canManagePolls && polls.length > 0 && !hasLivePolls ? (
          <View className="mt-3 rounded-xl bg-amber-50 px-4 py-2 flex-row items-center">
            <Text className="text-sm text-amber-700" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
              No polls are live yet — tap "Go live" before sharing the link.
            </Text>
          </View>
        ) : null}
      </View>

      {/* Scrollable polls */}
      <ScrollView
        ref={mainScrollRef}
        contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: insets.bottom + 100 }}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={accentColor} />
        }
      >
        {polls.length === 0 ? (
          <View className="mt-12 items-center gap-4">
            {canManagePolls ? (
              <Button onPress={() => router.push(`/(app)/trips/${id}/polls/new`)} className="self-center">
                Add first poll
              </Button>
            ) : null}
            <Text className="text-lg font-semibold text-ink">
              {canManagePolls ? 'Create a poll to rally your squad' : 'No polls yet'}
            </Text>
            <Text className="text-center text-sm text-muted">
              {canManagePolls
                ? 'Build polls for destination, dates, and budget — then share the link.'
                : 'The trip planner hasn\'t created any polls yet.'}
            </Text>
          </View>
        ) : null}

        {sortedPolls.length > 0 ? (
          <View className="flex-row items-center justify-between pt-4 pb-2">
            <Text className="text-base font-bold text-ink">Polls</Text>
            <Pressable
              onPress={() => setSortNewest((prev) => !prev)}
              className="flex-row items-center gap-1"
              accessibilityRole="button"
            >
              <Ionicons name={sortNewest ? 'arrow-down' : 'arrow-up'} size={13} color="#A8A8A8" />
              <Text className="text-xs text-muted">
                {sortNewest ? 'Newest first' : 'Oldest first'}
              </Text>
            </Pressable>
          </View>
        ) : null}

        {livePolls.length > 0 ? (
          <View className="mb-1">
            <Pressable
              onPress={() => setLiveCollapsed((prev) => !prev)}
              className="mb-2 flex-row items-center justify-between"
              accessibilityRole="button"
            >
              <Text className="text-xs font-semibold uppercase tracking-wider text-green-600">Live</Text>
              <Ionicons name={liveCollapsed ? 'chevron-up' : 'chevron-down'} size={13} color="#A8A8A8" />
            </Pressable>
            {!liveCollapsed && livePolls.map((poll) => (
              <PollCard key={poll.id} poll={poll} tripId={id} counts={responseCounts[poll.id] ?? {}} groupSizeBucket={trip?.group_size_bucket} groupSizePrecise={trip?.group_size_precise} router={router} canManagePolls={canManagePolls} accentColor={accentColor} />
            ))}
          </View>
        ) : null}

        {draftPolls.length > 0 ? (
          <View className="mb-1">
            <Pressable
              onPress={() => setDraftCollapsed((prev) => !prev)}
              className="mb-2 flex-row items-center justify-between"
              accessibilityRole="button"
            >
              <Text className="text-xs font-semibold uppercase tracking-wider text-muted">Draft</Text>
              <Ionicons name={draftCollapsed ? 'chevron-up' : 'chevron-down'} size={13} color="#A8A8A8" />
            </Pressable>
            {!draftCollapsed && draftPolls.map((poll) => (
              <PollCard key={poll.id} poll={poll} tripId={id} counts={responseCounts[poll.id] ?? {}} groupSizeBucket={trip?.group_size_bucket} groupSizePrecise={trip?.group_size_precise} router={router} canManagePolls={canManagePolls} accentColor={accentColor} />
            ))}
          </View>
        ) : null}

        {closedPolls.length > 0 ? (
          <View className="mb-1">
            <Pressable
              onPress={() => setClosedCollapsed((prev) => !prev)}
              className="mb-2 flex-row items-center justify-between"
              accessibilityRole="button"
            >
              <Text className="text-xs font-semibold uppercase tracking-wider text-ink">Closed</Text>
              <Ionicons name={closedCollapsed ? 'chevron-up' : 'chevron-down'} size={13} color="#A8A8A8" />
            </Pressable>
            {!closedCollapsed && closedPolls.map((poll) => (
              <PollCard key={poll.id} poll={poll} tripId={id} counts={responseCounts[poll.id] ?? {}} groupSizeBucket={trip?.group_size_bucket} groupSizePrecise={trip?.group_size_precise} router={router} canManagePolls={canManagePolls} accentColor={accentColor} />
            ))}
          </View>
        ) : null}

        {decidedPolls.length > 0 ? (
          <View className="mt-2" onLayout={(e) => setDecidedSectionY(e.nativeEvent.layout.y)}>
            <View className="mb-2 flex-row items-center gap-2">
              <View className="h-px flex-1 bg-line" />
              <Text className="text-xs font-semibold uppercase tracking-wider" style={{ color: accentColor }}>Decided</Text>
              <View className="h-px flex-1 bg-line" />
            </View>
            {decidedPolls.map((poll) => (
              <View key={poll.id} onLayout={(e) => { const y = e.nativeEvent.layout.y; setDecidedCardYs((prev) => ({ ...prev, [poll.id]: y })); }}>
                <PollCard poll={poll} tripId={id} counts={responseCounts[poll.id] ?? {}} groupSizeBucket={trip?.group_size_bucket} groupSizePrecise={trip?.group_size_precise} router={router} canManagePolls={canManagePolls} accentColor={accentColor} />
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </View>

    <PreciseGroupSizeModal
      visible={preciseModalVisible}
      current={trip?.group_size_precise ?? null}
      onSave={(n) => {
        if (trip) updateTrip.mutate({ id: trip.id, group_size_precise: n });
        setPreciseModalVisible(false);
      }}
      onClose={() => setPreciseModalVisible(false)}
    />

    <TravelWindowModal
      visible={travelWindowModalVisible}
      current={trip?.travel_window ?? null}
      onSave={(value) => {
        if (trip) updateTrip.mutate({ id: trip.id, travel_window: value ?? undefined });
        setTravelWindowModalVisible(false);
      }}
      onClose={() => setTravelWindowModalVisible(false)}
    />
    </>
  );
}

const SEASONS = ['Winter', 'Spring', 'Summer', 'Fall'] as const;

function TravelWindowModal({
  visible,
  current,
  onSave,
  onClose,
}: {
  visible: boolean;
  current: string | null;
  onSave: (value: string | null) => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const translateY = useRef(new Animated.Value(0)).current;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, { dy }) => dy > 5,
      onPanResponderMove: (_, { dy }) => {
        if (dy > 0) translateY.setValue(dy);
      },
      onPanResponderRelease: (_, { dy, vy }) => {
        if (dy > 80 || vy > 0.5) {
          Animated.timing(translateY, { toValue: 600, duration: 200, useNativeDriver: true }).start(() => {
            translateY.setValue(0);
            onClose();
          });
        } else {
          Animated.spring(translateY, { toValue: 0, useNativeDriver: true }).start();
        }
      },
    })
  ).current;

  useEffect(() => {
    if (visible) {
      translateY.setValue(0);
      setSelected(current ? current.split(', ') : []);
    }
  }, [visible, current]);

  function toggle(season: string) {
    setSelected((prev) =>
      prev.includes(season) ? prev.filter((s) => s !== season) : [...prev, season]
    );
  }

  function handleSave() {
    onSave(selected.length > 0 ? selected.join(', ') : null);
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }} onPress={onClose}>
        <Animated.View style={{ transform: [{ translateY }], backgroundColor: 'white', borderTopLeftRadius: 24, borderTopRightRadius: 24 }}>
          <View {...panResponder.panHandlers} style={{ alignItems: 'center', paddingTop: 12, paddingBottom: 4 }}>
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: '#E7DDCF' }} />
          </View>
          <Pressable onPress={() => {}} style={{ padding: 24, paddingTop: 12, gap: 16 }}>
            <Text style={{ fontSize: 17, fontWeight: '600', color: '#163026' }}>Rough travel window</Text>
            <Text style={{ fontSize: 14, color: '#737373', marginTop: -8 }}>Select the seasons you're considering.</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {SEASONS.map((season) => {
                const isSelected = selected.includes(season);
                return (
                  <Pressable
                    key={season}
                    onPress={() => toggle(season)}
                    style={{
                      flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                      gap: 6, paddingVertical: 10, borderRadius: 999, borderWidth: 1.5,
                      borderColor: isSelected ? '#0F3F2E' : '#E7DDCF',
                      backgroundColor: isSelected ? '#FFF4F2' : 'white',
                    }}
                  >
                    <Ionicons name={SEASON_ICON[season] ?? 'sunny-outline'} size={14} color={isSelected ? '#0F3F2E' : '#737373'} />
                    <Text style={{ fontSize: 14, fontWeight: '500', color: isSelected ? '#0F3F2E' : '#525252' }}>{season}</Text>
                  </Pressable>
                );
              })}
            </View>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Pressable onPress={onClose} style={{ flex: 1, paddingVertical: 14, borderRadius: 14, borderWidth: 1.5, borderColor: '#E7DDCF', alignItems: 'center' }}>
                <Text style={{ fontSize: 15, fontWeight: '600', color: '#525252' }}>Cancel</Text>
              </Pressable>
              <Pressable onPress={handleSave} style={{ flex: 1, paddingVertical: 14, borderRadius: 14, backgroundColor: '#0F3F2E', alignItems: 'center' }}>
                <Text style={{ fontSize: 15, fontWeight: '600', color: 'white' }}>{selected.length === 0 ? 'Clear' : 'Save'}</Text>
              </Pressable>
            </View>
          </Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}
