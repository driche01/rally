/**
 * TravelerProfileForm — post-trip-survey "About you" page.
 *
 * Captures the 13 traveler-preference questions across two pages:
 *   Page A: ✈️ Travel + 🏡 Lodging + 🍽️ Dining (8 questions)
 *   Page B: 🎯 Activities + 💰 Budget + Optional notes (5 questions)
 *
 * Returning respondents see their prior answers pre-filled with a
 * "Last updated …" caption; first-timers see an empty form with a
 * "Skip for now" link. Save uses the share_token + phone-gated
 * SECURITY DEFINER RPC.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/components/ui';
import airports from '@/data/airports.json';
import {
  emptyProfileDraft,
  TRAVEL_PREF_OPTIONS,
  FLIGHT_DEALBREAKER_OPTIONS,
  SLEEP_PREF_OPTIONS,
  LODGING_PREF_OPTIONS,
  DIETARY_OPTIONS,
  MEAL_PREF_OPTIONS,
  DRINKING_PREF_OPTIONS,
  PHYSICAL_LIMITATION_OPTIONS,
  TRIP_PACE_OPTIONS,
  ACTIVITY_TYPE_OPTIONS,
  BUDGET_POSTURE_OPTIONS,
  type TravelerProfile,
  type TravelerProfileDraft,
} from '@/types/profile';

// ─── Props ───────────────────────────────────────────────────────────────────

interface Props {
  /**
   * Phone the form is keyed off — used to seed the empty-state draft.
   * For the survey path this is the user's typed phone (normalized);
   * for the authenticated path it can be the user's account phone, or
   * an empty string when we don't need it (the auth RPC resolves the
   * row's phone server-side).
   */
  phone: string;
  initialProfile: TravelerProfile | null;
  /** Display name in the header (e.g. "Welcome back, Andrew"). */
  respondentFirstName?: string | null;
  /**
   * Persistence handler — abstracts over survey vs authenticated
   * paths. Returns ok/error so the form can render an inline message.
   */
  onSave: (
    draft: TravelerProfileDraft,
  ) => Promise<{ ok: boolean; reason?: string }>;
  onComplete: () => void;
  /** Override the first-page header copy (used by the auth-side edit screen). */
  introTitleOverride?: string;
  introSubtitleOverride?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  const dayMs = 86400000;
  const days = Math.round((Date.now() - t) / dayMs);
  if (days < 1) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.round(days / 7)}w ago`;
  if (days < 365) return `${Math.round(days / 30)}mo ago`;
  return `${Math.round(days / 365)}y ago`;
}

function toggleArrayValue<T extends string>(arr: T[], v: T): T[] {
  return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
}

// ─── Form ────────────────────────────────────────────────────────────────────

export function TravelerProfileForm({
  phone,
  initialProfile,
  respondentFirstName,
  onSave,
  onComplete,
  introTitleOverride,
  introSubtitleOverride,
}: Props) {
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState<TravelerProfileDraft>(() => {
    if (initialProfile) {
      const { user_id, created_at, updated_at, ...rest } = initialProfile;
      return rest;
    }
    return emptyProfileDraft(phone);
  });
  const [page, setPage] = useState<'A' | 'B'>('A');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Reset scroll to the top on every page change. Without this, hitting
  // Continue at the bottom of page A leaves you mid-way through page B.
  // Same for Back from B and the page-dot taps in the header.
  const scrollRef = useRef<ScrollView>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [page]);

  const isReturning = initialProfile !== null;

  // Hard-cap activity_types at 2.
  function toggleActivity(v: typeof ACTIVITY_TYPE_OPTIONS[number][0]) {
    setDraft((d) => {
      if (d.activity_types.includes(v)) {
        return { ...d, activity_types: d.activity_types.filter((x) => x !== v) };
      }
      if (d.activity_types.length >= 2) return d;
      return { ...d, activity_types: [...d.activity_types, v] };
    });
  }

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    const result = await onSave(draft);
    setSaving(false);
    if (!result.ok) {
      setSaveError(result.reason ?? 'Could not save. Try again.');
      return;
    }
    onComplete();
  }

  return (
    <View style={styles.container}>
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>
            {introTitleOverride
              ?? (isReturning ? `Welcome back${respondentFirstName ? `, ${respondentFirstName}` : ''}` : 'Quick — tell us about you')}
          </Text>
          <Text style={styles.headerSubtitle}>
            {introSubtitleOverride
              ?? (isReturning
                ? `These still right? Your last update was ${relativeTime(initialProfile!.updated_at)}.`
                : "We'll include your preferences and save it for next time, so you only fill it out once.")}
          </Text>
          {/* Page dots double as a tap target — without this you'd have to
              scroll the full Page A and hit Continue just to reach Page B. */}
          <View style={styles.pageDots}>
            {(['A', 'B'] as const).map((p, i) => (
              <Pressable
                key={p}
                onPress={() => setPage(p)}
                hitSlop={10}
                accessibilityRole="tab"
                accessibilityState={{ selected: page === p }}
                accessibilityLabel={`Go to page ${i + 1} of 2`}
              >
                <View style={[styles.dot, page === p && styles.dotActive]} />
              </Pressable>
            ))}
          </View>
        </View>

        {page === 'A' ? (
          <PageA draft={draft} setDraft={setDraft} />
        ) : (
          <PageB draft={draft} setDraft={setDraft} toggleActivity={toggleActivity} />
        )}

        {saveError ? <Text style={styles.errorText}>{saveError}</Text> : null}
      </ScrollView>

      {/* Sticky footer — matches the web view layout exactly:
          Page A → Continue only.
          Page B → Save changes primary + ← Back text link.

          paddingBottom calc — defensive on iOS: even if SafeAreaProvider
          context isn't wired correctly (insets.bottom returns 0), we still
          guarantee 36px clearance so the green button never gets clipped by
          the home indicator. On Android/web a flat 16 is plenty. */}
      <View
        style={[
          styles.footer,
          {
            paddingBottom:
              Platform.OS === 'ios'
                ? Math.max(insets.bottom + 12, 36)
                : 16,
          },
        ]}
      >
        {page === 'A' ? (
          <Button onPress={() => setPage('B')} fullWidth>
            Continue
          </Button>
        ) : (
          <>
            <Button onPress={handleSave} loading={saving} fullWidth>
              {isReturning ? 'Save changes' : 'Save profile'}
            </Button>
            <Pressable onPress={() => setPage('A')} hitSlop={8} style={{ alignSelf: 'center', marginTop: 12 }}>
              <Text style={styles.skipText}>← Back</Text>
            </Pressable>
          </>
        )}
      </View>
    </View>
  );
}

// ─── Page A: Travel + Lodging + Dining ───────────────────────────────────────

function PageA({
  draft,
  setDraft,
}: {
  draft: TravelerProfileDraft;
  setDraft: React.Dispatch<React.SetStateAction<TravelerProfileDraft>>;
}) {
  return (
    <>
      <Section icon="airplane-outline" title="Travel">
        <Question label="What's your home airport?">
          <AirportPicker
            value={draft.home_airport}
            onChange={(v) => setDraft((d) => ({ ...d, home_airport: v }))}
          />
        </Question>
        <Question label="When friends are planning a trip, you usually prefer to…">
          <RadioGroup
            options={TRAVEL_PREF_OPTIONS}
            value={draft.travel_pref}
            onChange={(v) => setDraft((d) => ({ ...d, travel_pref: v }))}
          />
        </Question>
        <Question label="Any flight dealbreakers?">
          <MultiGroup
            options={FLIGHT_DEALBREAKER_OPTIONS}
            value={draft.flight_dealbreakers}
            onChange={(v) => setDraft((d) => ({ ...d, flight_dealbreakers: v }))}
            noneLabel="None — I'm flexible"
          />
        </Question>
      </Section>

      <Section icon="bed-outline" title="Lodging">
        <Question label="Your sleeping setup preference">
          <RadioGroup
            options={SLEEP_PREF_OPTIONS}
            value={draft.sleep_pref}
            onChange={(v) => setDraft((d) => ({ ...d, sleep_pref: v }))}
          />
        </Question>
        <Question label="Where do you prefer to stay?">
          <RadioGroup
            options={LODGING_PREF_OPTIONS}
            value={draft.lodging_pref}
            onChange={(v) => setDraft((d) => ({ ...d, lodging_pref: v }))}
          />
        </Question>
      </Section>

      <Section icon="restaurant-outline" title="Dining">
        <Question label="Any dietary restrictions?">
          <MultiGroup
            options={DIETARY_OPTIONS}
            value={draft.dietary_restrictions}
            onChange={(v) => setDraft((d) => ({ ...d, dietary_restrictions: v }))}
            noneLabel="None"
          />
          {draft.dietary_restrictions.includes('allergies') || draft.dietary_restrictions.includes('other') ? (
            <TextInput
              value={draft.dietary_specifics ?? ''}
              onChangeText={(t) => setDraft((d) => ({ ...d, dietary_specifics: t || null }))}
              placeholder={
                draft.dietary_restrictions.includes('allergies')
                  ? 'List allergies (peanuts, shellfish, etc.)'
                  : 'Add detail'
              }
              placeholderTextColor="#a3a3a3"
              style={styles.specifyInput}
              multiline
            />
          ) : null}
        </Question>
        <Question label="How do you usually like to handle meals on group trips?">
          <RadioGroup
            options={MEAL_PREF_OPTIONS}
            value={draft.meal_pref}
            onChange={(v) => setDraft((d) => ({ ...d, meal_pref: v }))}
          />
        </Question>
        <Question label="Drinking preference">
          <RadioGroup
            options={DRINKING_PREF_OPTIONS}
            value={draft.drinking_pref}
            onChange={(v) => setDraft((d) => ({ ...d, drinking_pref: v }))}
          />
        </Question>
      </Section>
    </>
  );
}

// ─── Page B: Activities + Budget + Optional ──────────────────────────────────

function PageB({
  draft,
  setDraft,
  toggleActivity,
}: {
  draft: TravelerProfileDraft;
  setDraft: React.Dispatch<React.SetStateAction<TravelerProfileDraft>>;
  toggleActivity: (v: TravelerProfileDraft['activity_types'][number]) => void;
}) {
  return (
    <>
      <Section icon="compass-outline" title="Activities">
        <Question label="Any physical limitations to plan around?">
          <MultiGroup
            options={PHYSICAL_LIMITATION_OPTIONS}
            value={draft.physical_limitations}
            onChange={(v) => setDraft((d) => ({ ...d, physical_limitations: v }))}
            noneLabel="None"
          />
          {draft.physical_limitations.includes('other') ? (
            <TextInput
              value={draft.physical_specifics ?? ''}
              onChangeText={(t) => setDraft((d) => ({ ...d, physical_specifics: t || null }))}
              placeholder="Add detail"
              placeholderTextColor="#a3a3a3"
              style={styles.specifyInput}
              multiline
            />
          ) : null}
        </Question>
        <Question label="Your ideal trip pace">
          <RadioGroup
            options={TRIP_PACE_OPTIONS}
            value={draft.trip_pace}
            onChange={(v) => setDraft((d) => ({ ...d, trip_pace: v }))}
          />
        </Question>
        <Question label="What kinds of activities are you most into?" subline="Pick your top 2.">
          <ActivityChips
            options={ACTIVITY_TYPE_OPTIONS}
            value={draft.activity_types}
            onToggle={toggleActivity}
          />
        </Question>
      </Section>

      <Section icon="wallet-outline" title="Budget">
        <Question label="When the group is setting a budget, you're usually…">
          <RadioGroup
            options={BUDGET_POSTURE_OPTIONS}
            value={draft.budget_posture}
            onChange={(v) => setDraft((d) => ({ ...d, budget_posture: v }))}
          />
        </Question>
      </Section>

      <Section icon="document-text-outline" title="Optional">
        <Question label="Anything else the group should know?" subline="Allergies, accessibility needs, things you're working around, etc.">
          <TextInput
            value={draft.notes ?? ''}
            onChangeText={(t) => setDraft((d) => ({ ...d, notes: t || null }))}
            placeholder="Optional"
            placeholderTextColor="#a3a3a3"
            style={[styles.specifyInput, { minHeight: 80 }]}
            multiline
            maxLength={500}
          />
        </Question>
      </Section>
    </>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionTitleRow}>
        <Ionicons name={icon} size={16} color="#163026" />
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      <View style={{ gap: 16 }}>{children}</View>
    </View>
  );
}

function Question({ label, subline, children }: { label: string; subline?: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.qLabel}>{label}</Text>
      {subline ? <Text style={styles.qSubline}>{subline}</Text> : null}
      {children}
    </View>
  );
}

function RadioGroup<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: Array<[T, string]>;
  value: T | null;
  onChange: (v: T) => void;
}) {
  return (
    <View style={{ gap: 8 }}>
      {options.map(([v, label]) => {
        const sel = value === v;
        return (
          <Pressable
            key={String(v)}
            onPress={() => onChange(v)}
            style={[styles.optionRow, sel && styles.optionRowSel]}
            accessibilityRole="radio"
            accessibilityState={{ selected: sel }}
            accessibilityLabel={label}
          >
            <View style={[styles.radio, sel && styles.radioSel]}>
              {sel ? <View style={styles.radioInner} /> : null}
            </View>
            <Text style={[styles.optionText, sel && styles.optionTextSel]}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function MultiGroup<T extends string>({
  options,
  value,
  onChange,
  noneLabel,
}: {
  options: Array<[T, string]>;
  value: T[];
  onChange: (v: T[]) => void;
  /** When provided, an extra "None" row appears that's mutually exclusive with the others. */
  noneLabel?: string;
}) {
  const noneSelected = value.length === 0;
  return (
    <View style={{ gap: 8 }}>
      {noneLabel ? (
        <Pressable
          onPress={() => onChange([])}
          style={[styles.optionRow, noneSelected && styles.optionRowSel]}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: noneSelected }}
          accessibilityLabel={noneLabel}
        >
          <View style={[styles.checkbox, noneSelected && styles.checkboxSel]}>
            {noneSelected ? <Ionicons name="checkmark" size={14} color="#fff" /> : null}
          </View>
          <Text style={[styles.optionText, noneSelected && styles.optionTextSel]}>{noneLabel}</Text>
        </Pressable>
      ) : null}
      {options.map(([v, label]) => {
        const sel = value.includes(v);
        return (
          <Pressable
            key={v}
            onPress={() => onChange(toggleArrayValue(value, v))}
            style={[styles.optionRow, sel && styles.optionRowSel]}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: sel }}
            accessibilityLabel={label}
          >
            <View style={[styles.checkbox, sel && styles.checkboxSel]}>
              {sel ? <Ionicons name="checkmark" size={14} color="#fff" /> : null}
            </View>
            <Text style={[styles.optionText, sel && styles.optionTextSel]}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function ActivityChips<T extends string>({
  options,
  value,
  onToggle,
}: {
  options: Array<[T, string]>;
  value: T[];
  onToggle: (v: T) => void;
}) {
  const atCap = value.length >= 2;
  return (
    <View style={styles.chipsWrap}>
      {options.map(([v, label]) => {
        const sel = value.includes(v);
        const dimmed = atCap && !sel;
        return (
          <Pressable
            key={v}
            onPress={() => onToggle(v)}
            disabled={dimmed}
            style={[styles.chip, sel && styles.chipSel, dimmed && { opacity: 0.45 }]}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: sel, disabled: dimmed }}
            accessibilityLabel={label}
          >
            <Text style={[styles.chipText, sel && styles.chipTextSel]}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function AirportPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  const [query, setQuery] = useState(value ?? '');
  const [open, setOpen] = useState(false);

  // Keep input in sync if the parent's value changes externally.
  useEffect(() => {
    setQuery(value ?? '');
  }, [value]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length === 0) return [];
    return airports
      .filter(
        (a) =>
          a.iata.toLowerCase().startsWith(q) ||
          a.city.toLowerCase().includes(q) ||
          a.name.toLowerCase().includes(q),
      )
      .slice(0, 6);
  }, [query]);

  function commit(iata: string, displayLabel: string) {
    onChange(iata);
    setQuery(displayLabel);
    setOpen(false);
  }

  return (
    <View>
      <TextInput
        value={query}
        onChangeText={(t) => {
          setQuery(t);
          setOpen(true);
          // Clear any previously committed code as the planner edits.
          if (value !== null) onChange(null);
        }}
        onFocus={() => setOpen(true)}
        placeholder="e.g. SFO, San Francisco"
        placeholderTextColor="#a3a3a3"
        autoCorrect={false}
        autoCapitalize="characters"
        style={styles.airportInput}
      />
      {open && matches.length > 0 ? (
        <View style={styles.airportList}>
          {matches.map((a) => (
            <Pressable
              key={a.iata}
              onPress={() => commit(a.iata, `${a.iata} · ${a.city}`)}
              style={({ pressed }) => [styles.airportRow, pressed && { backgroundColor: '#F3F1EC' }]}
              accessibilityRole="button"
            >
              <Text style={styles.airportIata}>{a.iata}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.airportCity}>{a.city}</Text>
                <Text style={styles.airportName} numberOfLines={1}>
                  {a.name}
                </Text>
              </View>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FBF7EF' },
  scroll: { flex: 1, backgroundColor: '#FBF7EF' },
  scrollContent: { paddingHorizontal: 20, paddingVertical: 24, paddingBottom: 24 },

  header: { gap: 6, marginBottom: 20 },
  headerTitle: { fontSize: 22, fontWeight: '700', color: '#163026' },
  headerSubtitle: { fontSize: 14, color: '#5F685F' },
  pageDots: { flexDirection: 'row', gap: 6, marginTop: 10 },
  dot: { width: 24, height: 4, borderRadius: 2, backgroundColor: '#D9CCB6' },
  dotActive: { backgroundColor: '#0F3F2E' },

  section: {
    backgroundColor: '#FFFCF6',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#D9CCB6',
    padding: 16,
    marginBottom: 14,
    gap: 14,
  },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: '#163026' },

  qLabel: { fontSize: 14, fontWeight: '500', color: '#262626' },
  qSubline: { fontSize: 12, color: '#737373', marginTop: -4 },

  optionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E5E0D5',
    backgroundColor: '#FBF7EF',
  },
  optionRowSel: { borderColor: '#0F3F2E', backgroundColor: '#DFE8D2' },
  optionText: { flex: 1, fontSize: 14, color: '#404040', lineHeight: 19 },
  optionTextSel: { color: '#0F3F2E', fontWeight: '500' },

  radio: {
    width: 18, height: 18, borderRadius: 9,
    borderWidth: 1.5, borderColor: '#A0A0A0',
    alignItems: 'center', justifyContent: 'center', marginTop: 1,
  },
  radioSel: { borderColor: '#0F3F2E' },
  radioInner: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#0F3F2E' },

  checkbox: {
    width: 18, height: 18, borderRadius: 4,
    borderWidth: 1.5, borderColor: '#A0A0A0',
    alignItems: 'center', justifyContent: 'center', marginTop: 1,
  },
  checkboxSel: { borderColor: '#0F3F2E', backgroundColor: '#0F3F2E' },

  specifyInput: {
    borderRadius: 10, borderWidth: 1, borderColor: '#D9CCB6',
    backgroundColor: '#FFFCF6',
    paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, color: '#163026',
    minHeight: 44, textAlignVertical: 'top',
  },

  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 999, borderWidth: 1.5, borderColor: '#E5E0D5',
    backgroundColor: '#FBF7EF',
  },
  chipSel: { borderColor: '#0F3F2E', backgroundColor: '#DFE8D2' },
  chipText: { fontSize: 13, color: '#404040' },
  chipTextSel: { color: '#0F3F2E', fontWeight: '600' },

  airportInput: {
    borderRadius: 12, borderWidth: 1, borderColor: '#D9CCB6',
    backgroundColor: '#FFFCF6',
    paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, color: '#163026',
  },
  airportList: {
    marginTop: 6,
    borderRadius: 12, borderWidth: 1, borderColor: '#D9CCB6',
    backgroundColor: '#FFFCF6', overflow: 'hidden',
  },
  airportRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingHorizontal: 14, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E8DFC8',
  },
  airportIata: {
    minWidth: 56, fontSize: 14, fontWeight: '700', color: '#0F3F2E',
    backgroundColor: '#DFE8D2', borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 7, textAlign: 'center',
    letterSpacing: 0.5, overflow: 'hidden',
  },
  // marginTop opens up the stacked city + name lines so they don't read as
  // a single squished block (especially on narrow iOS widths).
  airportCity: { fontSize: 15, color: '#163026', fontWeight: '600', lineHeight: 20 },
  airportName: { fontSize: 13, color: '#737373', lineHeight: 18, marginTop: 3 },

  errorText: { fontSize: 13, color: '#9A2A2A', marginVertical: 8, textAlign: 'center' },

  // Sticky footer — sits below the ScrollView so its buttons stay visible
  // regardless of scroll position. Top border + slight elevation give it a
  // visual lift off the form content above.
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
    backgroundColor: '#FBF7EF',
    borderTopWidth: 1,
    borderTopColor: '#E5E0D5',
  },
  skipText: { fontSize: 14, color: '#5F685F' },
});
