import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getRespondentsForTrip,
  getOrCreateRespondent,
  submitPollResponses,
  setRespondentPlanner,
} from '../lib/api/respondents';

export const respondentKeys = {
  forTrip: (tripId: string) => ['respondents', tripId] as const,
};

export function useRespondents(tripId: string) {
  return useQuery({
    queryKey: respondentKeys.forTrip(tripId),
    queryFn: () => getRespondentsForTrip(tripId),
    enabled: Boolean(tripId),
  });
}

export function useSetRespondentPlanner(tripId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ respondentId, isPlanner }: { respondentId: string; isPlanner: boolean }) =>
      setRespondentPlanner(respondentId, isPlanner),
    onSuccess: () => qc.invalidateQueries({ queryKey: respondentKeys.forTrip(tripId) }),
  });
}

export function useSubmitResponses(tripId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      name,
      responses,
    }: {
      name: string;
      responses: { pollId: string; optionIds: string[] }[];
    }) => {
      const respondent = await getOrCreateRespondent(tripId, name);
      for (const r of responses) {
        await submitPollResponses(r.pollId, respondent.id, r.optionIds);
      }
      return respondent;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: respondentKeys.forTrip(tripId) });
    },
  });
}
