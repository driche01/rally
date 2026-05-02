/**
 * GroupPreferencesCard — top-of-Group-Dashboard summary of every
 * participant's traveler-profile answers.
 *
 * Top section: aggregated rows (group composition, things to plan
 * around, top activities, pace, lodging lean, etc.) — each selected
 * to give the planner a one-glance read on who's coming and how to
 * plan around them.
 *
 * Drill-in: tap "See individual answers" to reveal a roster of
 * per-person profile cards. Each card shows the answers that person
 * gave. Phones with no profile yet render as a light "hasn't filled
 * out their profile yet" row.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getProfilesForTripSession, type ParticipantWithProfile } from '@/lib/api/travelerProfiles';
import { aggregateProfiles } from '@/lib/aggregateProfiles';
import {
  ACTIVITY_TYPE_OPTIONS,
  BUDGET_POSTURE_OPTIONS,
  DIETARY_OPTIONS,
  DRINKING_PREF_OPTIONS,
  FLIGHT_DEALBREAKER_OPTIONS,
  LODGING_PREF_OPTIONS,
  MEAL_PREF_OPTIONS,
  PHYSICAL_LIMITATION_OPTIONS,
  SLEEP_PREF_OPTIONS,
  TRAVEL_PREF_OPTIONS,
  TRIP_PACE_LABELS,
  type TravelerProfile,
} from '@/types/profile';

interface Props {
  /** Trip-session id to scope the profile fetch. Renders nothing when null. */
  sessionId: string | undefined;
}

function labelFor<T extends string>(options: Array<[T, string]>, value: T | null | undefined): string {
  if (!value) return '';
  return options.find(([v]) => v === value)?.[1] ?? value;
}

/**
 * Short, scannable labels for the aggregated rows. The full labels live
 * in profile.ts and drive the form; the card uses these compact
 * versions so each row reads at a glance.
 */
const SHORT_LABELS: Record<string, string> = {
  // Travel
  with_group: 'Together',
  with_group_flexible: 'Together (flexible)',
  separate: 'Separate',
  no_pref: 'No pref',
  // Lodging
  hotel: 'Hotel',
  rental: 'Airbnb',
  either: 'Either',
  // Meals
  eat_out: 'Eat out',
  mixed: 'Mix',
  cook_in: 'Cook in',
  // Drinking
  drinker_central: 'Drinks',
  casual: 'Casual',
  sober_friendly: 'Sober-friendly',
  low_no: 'Low/no alcohol',
  // Budget
  splurge: 'Splurge',
  middle: 'Middle',
  budget: 'Budget-friendly',
  flexible: 'Flexible',
  // Sleep
  own_room: 'Own room',
  own_bed: 'Own bed',
  share_bed: 'Share bed',
};

function shortLabel(value: string | undefined | null): string {
  if (!value) return '';
  return SHORT_LABELS[value] ?? value;
}

function relativeAgo(iso: string | undefined | null): string {
  if (!iso) return 'never';
  const days = Math.round((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days < 1) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.round(days / 7)}w ago`;
  if (days < 365) return `${Math.round(days / 30)}mo ago`;
  return `${Math.round(days / 365)}y ago`;
}

export function GroupPreferencesCard({ sessionId }: Props) {
  const [rows, setRows] = useState<ParticipantWithProfile[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!sessionId) {
      console.log('[GroupPreferencesCard] no sessionId, skipping fetch');
      setRows([]);
      return;
    }
    setLoading(true);
    getProfilesForTripSession(sessionId)
      .then((data) => {
        if (!cancelled) setRows(data);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const agg = useMemo(() => {
    if (!rows) return null;
    return aggregateProfiles(rows.map((r) => r.profile));
  }, [rows]);

  // Set of values that surface in the group-level "Plan around" pill,
  // bucketed by category. Used to flag the matching field on each
  // IndividualProfile card so the planner can immediately see *who*
  // each flagged need belongs to. Mirrors the filter rule NeedsRow uses
  // to compose the parts list (drops zero-count "other" rows).
  const flaggedNeedValues = useMemo(() => {
    if (!agg) return null;
    const dietary  = new Set(agg.needs.dietary
      .filter((c) => c.value !== 'other' || c.count > 0)
      .map((c) => c.value));
    const physical = new Set(agg.needs.physical
      .filter((c) => c.value !== 'other' || c.count > 0)
      .map((c) => c.value));
    const flights  = new Set(agg.needs.flightDealbreakers.map((c) => c.value));
    return { dietary, physical, flights };
  }, [agg]);

  if (!sessionId) return null;

  if (loading && !rows) {
    return (
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>Group preferences</Text>
        </View>
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color="#0F3F2E" />
          <Text style={styles.loadingText}>Loading profiles…</Text>
        </View>
      </View>
    );
  }

  if (!agg || agg.totalParticipants === 0) {
    return null;
  }

  // ─── Build the rows we'll render in the aggregated section. ──────────────
  // Each one is null-safe: skipped when there's no useful signal.

  return (
    <View style={styles.card}>
      {/* Header — tap toggles the aggregations below NeedsRow.
          Header + completion + NeedsRow stay always visible so the
          attention-flag stuff (Plan around) is never hidden. */}
      <Pressable
        onPress={() => setExpanded((v) => !v)}
        style={styles.headerRow}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={expanded ? 'Collapse group preferences' : 'Expand group preferences'}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
          <Ionicons name="person-circle-outline" size={16} color="#163026" />
          <Text style={styles.title}>Group preferences</Text>
          <Text style={[styles.completion, { fontSize: 12, marginLeft: 4 }]}>
            · {agg.filledProfiles} {agg.filledProfiles === 1 ? 'response' : 'responses'}
          </Text>
        </View>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={16}
          color="#5F685F"
        />
      </Pressable>

      {agg.filledProfiles > 0 ? (
        <View style={styles.aggList}>
          {/* Things to plan around — always visible (this is the
              attention-flag the planner needs at a glance, even when
              the rest of the aggregations are collapsed). */}
          <NeedsRow agg={agg} />

          {!expanded ? null : (
          <>
          {/* Top activities */}
          {agg.topActivities.length > 0 ? (
            <AggRow
              icon="sparkles-outline"
              label="Top activity picks"
              value={agg.topActivities
                .slice(0, 3)
                .map((c) => `${c.label.split(' ')[0]} (${c.count})`)
                .join(' · ')}
            />
          ) : null}

          {/* Pace — drop the numeric prefix, just the rounded label. */}
          {agg.avgPace ? (
            <AggRow
              icon="speedometer-outline"
              label="Group pace"
              value={TRIP_PACE_LABELS[Math.round(agg.avgPace.avg) as 1 | 2 | 3 | 4]}
            />
          ) : null}

          {/* Lodging */}
          {agg.lodging.dominant ? (
            <AggRow
              icon="bed-outline"
              label="Lodging"
              value={`${shortLabel(agg.lodging.dominant.value)} · ${agg.lodging.dominant.count}/${agg.filledProfiles}`}
            />
          ) : null}

          {/* Meals */}
          {agg.meals.dominant ? (
            <AggRow
              icon="restaurant-outline"
              label="Meals"
              value={`${shortLabel(agg.meals.dominant.value)} · ${agg.meals.dominant.count}/${agg.filledProfiles}`}
            />
          ) : null}

          {/* Travel */}
          {agg.travel.dominant ? (
            <AggRow
              icon="airplane-outline"
              label="Travel"
              value={`${shortLabel(agg.travel.dominant.value)} · ${agg.travel.dominant.count}/${agg.filledProfiles}`}
            />
          ) : null}

          {/* Airports */}
          {agg.airports.length > 0 ? (
            <AggRow
              icon="location-outline"
              label="From"
              value={agg.airports.map((a) => `${a.iata} · ${a.count}`).join(' · ')}
            />
          ) : null}

          {/* Budget */}
          {agg.budget.dominant ? (
            <AggRow
              icon="wallet-outline"
              label="Budget"
              value={`${shortLabel(agg.budget.dominant.value)} · ${agg.budget.dominant.count}/${agg.filledProfiles}`}
            />
          ) : null}

          {/* Drinking */}
          {agg.drinking.dominant ? (
            <AggRow
              icon="wine-outline"
              label="Drinking"
              value={`${shortLabel(agg.drinking.dominant.value)} · ${agg.drinking.dominant.count}/${agg.filledProfiles}`}
            />
          ) : null}

          {/* Notes flag */}
          {agg.notesCount > 0 ? (
            <AggRow
              icon="reader-outline"
              label="Notes"
              value={`${agg.notesCount} · see individual answers`}
            />
          ) : null}
          </>
          )}
        </View>
      ) : null}

      {/* Individual answers — always shown alongside the aggregate when
          the outer card is expanded. Collapsed state stays minimal. */}
      {expanded && rows ? (
        <View style={styles.individualList}>
          {rows.map((r) => (
            <IndividualProfile
              key={r.participant_id}
              row={r}
              flaggedNeeds={flaggedNeedValues}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function AggRow({
  icon,
  label,
  value,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  value: string;
}) {
  return (
    <View style={styles.aggRow}>
      <Ionicons name={icon} size={13} color="#5F685F" style={styles.aggIcon} />
      <Text style={styles.aggLabel}>{label}</Text>
      <Text style={styles.aggValue} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

function NeedsRow({ agg }: { agg: ReturnType<typeof aggregateProfiles> }) {
  // Combine the three need lists into a single line. Skip "None" — the
  // empty array semantically means "flexible / no restrictions."
  const dietary = agg.needs.dietary.filter((c) => c.value !== 'other' || c.count > 0);
  const physical = agg.needs.physical.filter((c) => c.value !== 'other' || c.count > 0);
  const flights = agg.needs.flightDealbreakers;

  const parts: string[] = [];
  for (const c of dietary) {
    parts.push(`${c.count} ${c.label.toLowerCase().replace(' (specify)', '')}`);
  }
  for (const c of physical) {
    parts.push(`${c.count} ${c.label.toLowerCase().replace(' (specify)', '')}`);
  }
  for (const c of flights) {
    parts.push(`${c.count} avoid ${c.label.toLowerCase()}`);
  }

  if (parts.length === 0) {
    return (
      <View style={[styles.aggRow, styles.aggRowFlex]}>
        <Ionicons name="checkmark-circle-outline" size={13} color="#1D9E75" style={styles.aggIcon} />
        <Text style={styles.aggLabel}>No flagged needs</Text>
        <Text style={[styles.aggValue, { color: '#5F685F' }]}>Group is flexible.</Text>
      </View>
    );
  }

  return (
    <View style={[styles.aggRow, styles.aggRowNeeds]}>
      <Ionicons name="alert-circle" size={13} color="#92400E" style={styles.aggIcon} />
      <Text style={[styles.aggLabel, { color: '#92400E' }]}>Plan around</Text>
      <Text style={[styles.aggValue, { color: '#78350F' }]}>{parts.join(' · ')}</Text>
    </View>
  );
}

interface FlaggedNeedSets {
  dietary: Set<string>;
  physical: Set<string>;
  flights: Set<string>;
}

function IndividualProfile({
  row,
  flaggedNeeds,
}: {
  row: ParticipantWithProfile;
  flaggedNeeds: FlaggedNeedSets | null;
}) {
  const [open, setOpen] = useState(false);
  const name = row.display_name || row.phone || 'Participant';

  if (!row.profile) {
    return (
      <View style={styles.indCard}>
        <View style={styles.indHeader}>
          <Text style={styles.indName}>{name}</Text>
          <Text style={styles.indMissingPill}>Profile not filled yet</Text>
        </View>
      </View>
    );
  }

  const p = row.profile;

  // Per-field flag: true when any of this person's values for that
  // category appear in the group-level "Plan around" set. Lets us tint
  // the field block amber so the planner can spot who's vegan / who
  // can't do early-morning flights / etc. at a glance.
  const dietFlagged     = !!flaggedNeeds && p.dietary_restrictions.some((v) => flaggedNeeds.dietary.has(v));
  const physicalFlagged = !!flaggedNeeds && p.physical_limitations.some((v) => flaggedNeeds.physical.has(v));
  const flightFlagged   = !!flaggedNeeds && p.flight_dealbreakers.some((v) => flaggedNeeds.flights.has(v));
  const hasFlaggedNeed  = dietFlagged || physicalFlagged || flightFlagged;

  return (
    <View style={[styles.indCard, hasFlaggedNeed && styles.indCardFlagged]}>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        style={styles.indHeader}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={
          open ? `Collapse ${name}'s profile` : `Expand ${name}'s profile`
        }
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
          <Text style={styles.indName}>{name}</Text>
          {/* Header-level "Plan around" pill — visible while collapsed so
              the planner can scan the roster for flagged people without
              expanding every card. */}
          {hasFlaggedNeed ? (
            <View style={styles.indNeedPill}>
              <Ionicons name="alert-circle" size={11} color="#92400E" />
              <Text style={styles.indNeedPillText}>Plan around</Text>
            </View>
          ) : null}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={styles.indMeta}>Updated {relativeAgo(p.updated_at)}</Text>
          <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={14} color="#5F685F" />
        </View>
      </Pressable>

      {open ? (
        <View style={styles.indGrid}>
          <Field label="Home airport" value={p.home_airport} />
          <Field label="Travel" value={labelFor(TRAVEL_PREF_OPTIONS, p.travel_pref)} />
          <FieldList
            label="Flight dealbreakers"
            values={p.flight_dealbreakers.map((v) => labelFor(FLIGHT_DEALBREAKER_OPTIONS, v))}
            empty="Flexible"
            flagged={flightFlagged}
          />
          <Field label="Sleep" value={labelFor(SLEEP_PREF_OPTIONS, p.sleep_pref)} />
          <Field label="Lodging" value={labelFor(LODGING_PREF_OPTIONS, p.lodging_pref)} />
          <FieldList
            label="Diet"
            values={p.dietary_restrictions.map((v) => labelFor(DIETARY_OPTIONS, v))}
            empty="None"
            extra={p.dietary_specifics ?? undefined}
            flagged={dietFlagged}
          />
          <Field label="Meals" value={labelFor(MEAL_PREF_OPTIONS, p.meal_pref)} />
          <Field label="Drinking" value={labelFor(DRINKING_PREF_OPTIONS, p.drinking_pref)} />
          <FieldList
            label="Physical"
            values={p.physical_limitations.map((v) => labelFor(PHYSICAL_LIMITATION_OPTIONS, v))}
            empty="None"
            extra={p.physical_specifics ?? undefined}
            flagged={physicalFlagged}
          />
          <Field
            label="Pace"
            value={p.trip_pace ? `${p.trip_pace} — ${TRIP_PACE_LABELS[p.trip_pace]}` : null}
          />
          <FieldList
            label="Activities"
            values={p.activity_types.map((v) => labelFor(ACTIVITY_TYPE_OPTIONS, v).split(' (')[0])}
            empty="No picks"
          />
          <Field label="Budget" value={labelFor(BUDGET_POSTURE_OPTIONS, p.budget_posture)} />
          {p.notes ? <Field label="Notes" value={p.notes} fullWidth /> : null}
        </View>
      ) : null}
    </View>
  );
}

function Field({
  label,
  value,
  fullWidth,
}: {
  label: string;
  value: string | null | undefined;
  fullWidth?: boolean;
}) {
  if (!value) return null;
  return (
    <View style={[styles.field, fullWidth && { width: '100%' }]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldValue}>{value}</Text>
    </View>
  );
}

function FieldList({
  label,
  values,
  empty,
  extra,
  flagged,
}: {
  label: string;
  values: string[];
  empty?: string;
  extra?: string;
  /** True when one of `values` is in the group-level "Plan around" set.
   *  Tints the field amber so it stands out as the planner's reason for
   *  the parent card showing the "Plan around" header pill. */
  flagged?: boolean;
}) {
  const cleaned = values.map((v) => v.replace(/ \(specify\)$/, '')).filter(Boolean);
  if (cleaned.length === 0 && !empty) return null;
  return (
    <View style={[styles.field, flagged && styles.fieldFlagged]}>
      <Text style={[styles.fieldLabel, flagged && styles.fieldLabelFlagged]}>
        {label}
      </Text>
      <Text style={[styles.fieldValue, flagged && styles.fieldValueFlagged]}>
        {cleaned.length === 0 ? empty : cleaned.join(', ')}
      </Text>
      {extra ? (
        <Text style={[styles.fieldExtra, flagged && styles.fieldValueFlagged]}>
          {extra}
        </Text>
      ) : null}
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // Card chrome matched to AggregateResultsCard (Live results) so the
  // two siblings read as a pair on the dashboard.
  card: {
    backgroundColor: 'white',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#EBEBEB',
    padding: 14,
    marginBottom: 18,
    gap: 12,
  },

  // Header / title sized to match Live results' card header.
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 14, fontWeight: '700', color: '#163026' },

  completion: { fontSize: 13, color: '#5F685F' },

  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  loadingText: { fontSize: 13, color: '#5F685F' },

  // Inner rows match Live results' pollHeader pattern: icon (13px) +
  // bold label + muted value, single line, no fixed-width label column.
  // NeedsRow keeps the amber attention-flag treatment (analog of Live
  // results' green "Locked" pill).
  aggList: { gap: 6 },
  aggRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 },
  aggRowFlex: { backgroundColor: '#DFE8D2', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  aggRowNeeds: { backgroundColor: '#FEF3C7', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  aggIcon: {},
  aggLabel: { fontSize: 13, fontWeight: '600', color: '#404040' },
  aggValue: { flex: 1, fontSize: 13, color: '#5F685F', textAlign: 'right' },

  individualList: {
    gap: 10,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#F3F1EC',
    marginTop: 4,
  },
  indCard: {
    backgroundColor: '#FBF7EF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E0D5',
    padding: 12,
    gap: 8,
  },
  // Subtle amber border bump on the whole card when the participant
  // has at least one flagged need — keeps the card scannable in a
  // long roster.
  indCardFlagged: {
    borderColor: '#FDE68A',
    borderWidth: 1.5,
  },
  indHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  indName: { fontSize: 14, fontWeight: '700', color: '#163026' },
  indMeta: { fontSize: 11, color: '#737373' },
  indMissingPill: {
    fontSize: 11,
    color: '#737373',
    fontStyle: 'italic',
  },
  // Header pill — visible while the card is collapsed so the planner
  // can spot "who's the vegan" without expanding everyone. Mirrors the
  // amber palette used by the group-level "Plan around" row.
  indNeedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FEF3C7',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  indNeedPillText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#92400E',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  indGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  field: {
    width: '50%',
    paddingVertical: 4,
    paddingRight: 10,
  },
  // Field-level highlight for entries that match the group "Plan around"
  // set. Same amber palette as the group row — tells the planner exactly
  // *which* answer triggered the flag for this person.
  fieldFlagged: {
    backgroundColor: '#FEF3C7',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginVertical: 2,
    marginRight: 4,
  },
  fieldLabel: {
    fontSize: 10,
    color: '#888',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  fieldLabelFlagged: { color: '#92400E' },
  fieldValue: { fontSize: 12, color: '#163026', marginTop: 2, lineHeight: 16 },
  fieldValueFlagged: { color: '#78350F' },
  fieldExtra: { fontSize: 11, color: '#5F685F', marginTop: 2, fontStyle: 'italic' },
});
