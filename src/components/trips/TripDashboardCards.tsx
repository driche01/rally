/**
 * TripDashboardCards — the coordination-state cards that should be
 * the first thing a planner sees when they open an active trip.
 *
 * Composes (in order):
 *   - ResponsesDueCard      (red banner when responses_due has passed)
 *   - DecisionQueueCard     (pinned recommendations awaiting approval)
 *   - CadenceCard           (next nudge + planner controls)
 *   - AggregateResultsCard  (live vote totals across polls)
 *   - GroupPreferencesCard  (per-respondent traveler-profile aggregations
 *                            with individual-answer drill-in)
 *
 * Each child renders nothing when there's nothing to show, so this
 * stack collapses to zero height on a brand-new trip with no
 * participants and no polls yet.
 */
import React from 'react';
import { View } from 'react-native';
import { ResponsesDueCard } from './ResponsesDueCard';
import { DecisionQueueCard } from './DecisionQueueCard';
import { CadenceCard } from './CadenceCard';
import { AggregateResultsCard } from './AggregateResultsCard';
import { GroupPreferencesCard } from './GroupPreferencesCard';

interface Props {
  tripId: string;
  sessionId: string | undefined;
}

export function TripDashboardCards({ tripId, sessionId }: Props) {
  return (
    <View>
      <ResponsesDueCard tripId={tripId} sessionId={sessionId} />
      <DecisionQueueCard tripId={tripId} />
      <CadenceCard sessionId={sessionId} hideWhenEmpty />
      <AggregateResultsCard tripId={tripId} />
      <GroupPreferencesCard sessionId={sessionId} />
    </View>
  );
}
