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
import type { TripStage } from '@/lib/tripStage';

interface Props {
  tripId: string;
  sessionId: string | undefined;
  /** Computed by the parent. Drives stage-gated cards (currently CadenceCard). */
  stage: TripStage;
}

// Past planning, poll-completion nudges are stale: the trip is happening,
// over, or being reconciled. The scheduler skips them at fire time
// (reason='trip_started'); this hide makes the dashboard reflect that
// without waiting for each scheduled time to arrive.
const STAGES_HIDING_CADENCE: Record<TripStage, boolean> = {
  deciding: false,
  confirmed: false,
  planning: false,
  experiencing: true,
  reconciling: true,
  done: true,
};

export function TripDashboardCards({ tripId, sessionId, stage }: Props) {
  // Fire request_poll_recommendation for every live poll without a pending
  // rec on dashboard mount. RPC is idempotent so this is a no-op when recs
  // are already there; closes the gap between the cron's 15-min cadence
  // and the planner opening the trip.
  useAutoGenerateRecommendations(tripId);

  return (
    <View>
      <ResponsesDueCard tripId={tripId} sessionId={sessionId} />
      <DecisionQueueCard tripId={tripId} />
      {STAGES_HIDING_CADENCE[stage] ? null : (
        <CadenceCard sessionId={sessionId} hideWhenEmpty />
      )}
      <AggregateResultsCard tripId={tripId} />
      <GroupPreferencesCard sessionId={sessionId} />
    </View>
  );
}
