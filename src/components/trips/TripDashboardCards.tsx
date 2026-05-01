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
import { useAutoGenerateRecommendations } from '@/hooks/useRecommendations';

interface Props {
  tripId: string;
  sessionId: string | undefined;
}

export function TripDashboardCards({ tripId, sessionId }: Props) {
  // Fire request_poll_recommendation for every live poll without a pending
  // rec on dashboard mount. RPC is idempotent so this is a no-op when recs
  // are already there; closes the gap between the cron's 15-min cadence
  // and the planner opening the trip.
  useAutoGenerateRecommendations(tripId);

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
