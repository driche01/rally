/**
 * LiveSmsPreview — chat-bubble style preview of the initial outreach SMS
 * the planner is about to send. Now editable directly: tapping the
 * bubble lets the planner type their own version. Replaces the older
 * "Rally's intro text" + Customize-button flow.
 *
 * Behavior:
 *   - When `customIntroSms` is null, the bubble shows the auto-generated
 *     default (mirrors the scheduler's `initialOutreachSms` template)
 *     and recomputes live as fields like destination / book-by change.
 *   - Once the planner edits the bubble, `customIntroSms` is non-null
 *     and contains exactly what they typed. The auto-default no longer
 *     overrides their text.
 *   - Tap "Reset" (only visible when custom) to revert to default.
 *
 * Bracketed tokens ([Name], [Planner], [Destination], [Trip]) stay as
 * literals here — server-side substitution lives in
 * `_sms-shared/personalize.ts` and resolves them per-recipient at send time.
 */
import React from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const RECIPIENT_PLACEHOLDER = '[Name]';
const PLANNER_FALLBACK = 'A friend';
const MAX_LENGTH = 320;

interface Props {
  plannerFirstName?: string | null;
  destination?: string | null;
  responsesDueDate?: string | null;
  /** null = use the auto-generated default body. Non-null = planner override. */
  customIntroSms: string | null;
  onChange: (next: string | null) => void;
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

function formatShortDate(iso: string): string {
  const d = new Date(iso + 'T16:00:00.000Z');
  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const day = d.getUTCDate();
  return `${days[d.getUTCDay()]}, ${months[d.getUTCMonth()]} ${day}${ordinal(day)}`;
}

function buildDefaultBody(opts: Pick<Props, 'plannerFirstName' | 'destination' | 'responsesDueDate'>): string {
  const planner = (opts.plannerFirstName?.trim() || PLANNER_FALLBACK).split(/\s+/)[0];
  const dest = opts.destination ? ` to ${opts.destination}` : '';
  const byDate = opts.responsesDueDate ? ` by ${formatShortDate(opts.responsesDueDate)}` : '';
  return `Hey ${RECIPIENT_PLACEHOLDER} — ${planner} is planning a trip${dest} and wants your input${byDate}. Please complete a quick survey: TKTK`;
}

export function LiveSmsPreview({
  plannerFirstName,
  destination,
  responsesDueDate,
  customIntroSms,
  onChange,
}: Props) {
  const defaultBody = buildDefaultBody({ plannerFirstName, destination, responsesDueDate });
  const isCustom = customIntroSms !== null;
  const value = customIntroSms ?? defaultBody;

  function handleChange(text: string) {
    // If they erase everything, revert to default. Otherwise commit
    // whatever they typed as the override.
    if (text.trim().length === 0) {
      onChange(null);
    } else {
      onChange(text);
    }
  }

  function handleReset() {
    onChange(null);
  }

  return (
    <View
      style={{
        backgroundColor: 'white',
        borderRadius: 16,
        borderWidth: 1,
        borderColor: '#D9CCB6',
        padding: 14,
        gap: 8,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Ionicons name="chatbubble-outline" size={12} color="#0F3F2E" />
          <Text
            style={{
              fontSize: 11,
              fontWeight: '600',
              color: '#0F3F2E',
              letterSpacing: 0.6,
              textTransform: 'uppercase',
            }}
          >
            Preview · tap to edit
          </Text>
        </View>
        {isCustom ? (
          <Pressable onPress={handleReset} hitSlop={8} accessibilityRole="button" accessibilityLabel="Reset to default text">
            <Text style={{ fontSize: 11, fontWeight: '600', color: '#5F685F' }}>Reset</Text>
          </Pressable>
        ) : null}
      </View>
      <View
        style={{
          backgroundColor: '#F3F1EC',
          borderRadius: 12,
          paddingHorizontal: 12,
          paddingVertical: 10,
        }}
      >
        <TextInput
          value={value}
          onChangeText={handleChange}
          multiline
          maxLength={MAX_LENGTH}
          placeholder="Write your own message…"
          placeholderTextColor="#a3a3a3"
          style={{
            fontSize: 14,
            color: '#163026',
            lineHeight: 20,
            padding: 0,
            margin: 0,
            minHeight: 60,
            textAlignVertical: 'top',
          }}
          accessibilityLabel="Initial outreach SMS body"
        />
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ fontSize: 11, color: '#737373', flex: 1 }}>
          Use{' '}
          <Text style={{ color: '#404040' }}>[Name]</Text>,{' '}
          <Text style={{ color: '#404040' }}>[Planner]</Text>,{' '}
          <Text style={{ color: '#404040' }}>[Destination]</Text>, or{' '}
          <Text style={{ color: '#404040' }}>[Trip]</Text>
        </Text>
        <Text style={{ fontSize: 11, color: '#888' }}>{value.length}/{MAX_LENGTH}</Text>
      </View>
    </View>
  );
}
