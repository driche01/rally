/**
 * PlannerCoachCard — F2 AI Planning Coach
 *
 * Displayed on the trip dashboard (planner only). Fetches prioritized nudges
 * from the generate-nudge edge function and surfaces the top 2-3 action items.
 * Each nudge can either deep-link to the relevant tab or generate an AI SMS
 * draft that the planner sends themselves via the iOS Share sheet.
 *
 * Also exposes the auto-remind toggle (stored in agent_settings).
 */

import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import {
  useAgentSettings,
  useGenerateAgentMessage,
  useNudges,
  useUpsertAgentSettings,
  type NudgeScenario,
} from '@/hooks/useAgentCoach';
import type { Nudge } from '@/lib/api/agentCoach';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  tripId: string;
}

// ─── Nudge row ────────────────────────────────────────────────────────────────

function NudgeRow({
  nudge,
  tripId,
  onNavigate,
}: {
  nudge: Nudge;
  tripId: string;
  onNavigate: (target: string) => void;
}) {
  const generateMessage = useGenerateAgentMessage(tripId);
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);

  const isAgentAction = nudge.ctaTarget.startsWith('agent_message:');
  const isLoading = generateMessage.isPending;

  async function handleAgentCta() {
    if (!nudge.agentMessageScenario) return;
    try {
      const msg = await generateMessage.mutateAsync({
        scenario: nudge.agentMessageScenario as NudgeScenario,
      });
      setPendingMessage(msg);
      await sendMessage(msg);
    } catch {
      Alert.alert('Error', 'Could not generate message. Please try again.');
    }
  }

  async function sendMessage(text: string) {
    const encoded = encodeURIComponent(text);
    Alert.alert('Send to group', 'Choose how to send:', [
      {
        text: 'iMessage / SMS',
        onPress: () =>
          Linking.openURL(
            Platform.OS === 'ios' ? `sms:&body=${encoded}` : `sms:?body=${encoded}`
          ),
      },
      {
        text: 'More options…',
        onPress: async () => {
          try {
            await Share.share({ message: text });
          } catch {}
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  function handleCta() {
    if (isAgentAction) {
      handleAgentCta();
    } else {
      onNavigate(nudge.ctaTarget);
    }
  }

  return (
    <View style={styles.nudgeRow}>
      <View style={styles.nudgeDot} />
      <View style={styles.nudgeText}>
        <Text style={styles.nudgeTitle}>{nudge.title}</Text>
        <Text style={styles.nudgeSubtitle}>{nudge.subtitle}</Text>
      </View>
      <Pressable
        onPress={handleCta}
        disabled={isLoading}
        style={[styles.nudgeCtaBtn, isAgentAction && styles.nudgeCtaBtnAgent]}
        accessibilityRole="button"
      >
        {isLoading ? (
          <ActivityIndicator size="small" color={isAgentAction ? '#D85A30' : '#1A4060'} />
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            {isAgentAction ? (
              <Ionicons name="sparkles" size={12} color="#D85A30" />
            ) : null}
            <Text
              style={[
                styles.nudgeCtaText,
                isAgentAction && { color: '#D85A30' },
              ]}
            >
              {nudge.cta}
            </Text>
          </View>
        )}
      </Pressable>
    </View>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function PlannerCoachCard({ tripId }: Props) {
  const router = useRouter();
  const { data: nudges, isLoading: nudgesLoading, error } = useNudges(tripId);
  const { data: settings } = useAgentSettings(tripId);
  const upsertSettings = useUpsertAgentSettings(tripId);

  const autoRemind = settings?.auto_remind ?? false;

  function handleNavigate(target: string) {
    switch (target) {
      case 'polls':
        router.push(`/(app)/trips/${tripId}/polls`);
        break;
      case 'lodging':
        router.push(`/(app)/trips/${tripId}/hub?tab=lodging`);
        break;
      case 'travel':
        router.push(`/(app)/trips/${tripId}/hub?tab=travel`);
        break;
      case 'itinerary':
        router.push(`/(app)/trips/${tripId}/hub?tab=itinerary`);
        break;
      case 'expenses':
        router.push(`/(app)/trips/${tripId}/hub?tab=expenses`);
        break;
      case 'share':
        // Delegate to parent — not handled here
        break;
    }
  }

  // Don't render if we have no nudges, no loading, and no error
  if (!nudgesLoading && !error && (!nudges || nudges.length === 0)) return null;

  return (
    <View style={styles.card}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Ionicons name="sparkles" size={14} color="#D85A30" />
          <Text style={styles.headerTitle}>Planner coach</Text>
        </View>
        <View style={styles.headerRight}>
          <Text style={styles.autoLabel}>Auto-remind</Text>
          <Switch
            value={autoRemind}
            onValueChange={(val) => upsertSettings.mutate(val)}
            trackColor={{ false: '#E5E5E5', true: '#FDDDD8' }}
            thumbColor={autoRemind ? '#D85A30' : '#fff'}
            ios_backgroundColor="#E5E5E5"
            style={{ transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] }}
          />
        </View>
      </View>

      {/* Nudge list */}
      {nudgesLoading ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color="#D85A30" />
          <Text style={styles.loadingText}>Checking your trip…</Text>
        </View>
      ) : error ? (
        <Text style={styles.errorText}>Could not load suggestions right now.</Text>
      ) : (
        <View style={styles.nudgeList}>
          {nudges!.map((nudge) => (
            <NudgeRow
              key={nudge.id}
              nudge={nudge}
              tripId={tripId}
              onNavigate={handleNavigate}
            />
          ))}
        </View>
      )}

      {/* Auto-remind info */}
      {autoRemind ? (
        <View style={styles.autoRemindBanner}>
          <Ionicons name="information-circle-outline" size={12} color="#888" />
          <Text style={styles.autoRemindText}>
            Auto-remind on — you'll get a notification when a message is ready to send
          </Text>
        </View>
      ) : null}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  card: {
    backgroundColor: 'white',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: '#F0EDE8',
    gap: 12,
    shadowColor: '#D85A30',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1A1A1A',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  autoLabel: {
    fontSize: 12,
    color: '#888',
  },
  nudgeList: {
    gap: 10,
  },
  nudgeRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  nudgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#D85A30',
    marginTop: 5,
    flexShrink: 0,
  },
  nudgeText: {
    flex: 1,
    gap: 2,
  },
  nudgeTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1A1A1A',
    lineHeight: 18,
  },
  nudgeSubtitle: {
    fontSize: 12,
    color: '#888',
    lineHeight: 16,
  },
  nudgeCtaBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#1A4060',
    minWidth: 70,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nudgeCtaBtnAgent: {
    borderColor: '#D85A30',
    backgroundColor: '#FFF8F6',
  },
  nudgeCtaText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#1A4060',
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  loadingText: {
    fontSize: 13,
    color: '#888',
  },
  errorText: {
    fontSize: 12,
    color: '#AAA',
  },
  autoRemindBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 5,
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: '#F5F5F5',
  },
  autoRemindText: {
    fontSize: 11,
    color: '#AAA',
    flex: 1,
    lineHeight: 15,
  },
});
