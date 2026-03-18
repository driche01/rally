import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createPoll,
  decidePollAndSync,
  deletePoll,
  duplicatePoll,
  getPollsForTrip,
  getPollWithResults,
  undecidePollAndClear,
  updatePoll,
  updatePollOptions,
  updatePollStatus,
  type CreatePollInput,
} from '../lib/api/polls';
import { tripKeys } from './useTrips';
import type { PollStatus } from '../types/database';

export const pollKeys = {
  forTrip: (tripId: string) => ['polls', tripId] as const,
  results: (pollId: string) => ['polls', 'results', pollId] as const,
};

export function usePolls(tripId: string) {
  return useQuery({
    queryKey: pollKeys.forTrip(tripId),
    queryFn: () => getPollsForTrip(tripId),
    enabled: Boolean(tripId),
    refetchInterval: 30_000,
  });
}

export function usePollResults(pollId: string) {
  return useQuery({
    queryKey: pollKeys.results(pollId),
    queryFn: () => getPollWithResults(pollId),
    enabled: Boolean(pollId),
  });
}

export function useCreatePoll(tripId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePollInput) => createPoll(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: pollKeys.forTrip(tripId) });
    },
  });
}

export function useUpdatePollStatus(tripId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ pollId, status }: { pollId: string; status: PollStatus }) =>
      updatePollStatus(pollId, status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: pollKeys.forTrip(tripId) });
    },
  });
}

export function useDecidePoll(tripId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ pollId, optionId }: { pollId: string; optionId: string }) =>
      decidePollAndSync(pollId, optionId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: pollKeys.forTrip(tripId) });
      qc.invalidateQueries({ queryKey: tripKeys.detail(tripId) });
    },
  });
}

export function useUndecidePoll(tripId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (pollId: string) => undecidePollAndClear(pollId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: pollKeys.forTrip(tripId) });
      qc.invalidateQueries({ queryKey: tripKeys.detail(tripId) });
    },
  });
}

export function useDeletePoll(tripId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (pollId: string) => deletePoll(pollId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: pollKeys.forTrip(tripId) });
    },
  });
}

export function useUpdateCustomPoll(tripId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      pollId,
      title,
      status,
      allow_multi_select,
      options,
    }: {
      pollId: string;
      title: string;
      status: 'draft' | 'live';
      allow_multi_select: boolean;
      options: { label: string; position: number }[];
    }) => {
      await updatePoll(pollId, { title, status, allow_multi_select });
      await updatePollOptions(pollId, options);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: pollKeys.forTrip(tripId) });
    },
  });
}

export function useDuplicatePoll(tripId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (pollId: string) => duplicatePoll(pollId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: pollKeys.forTrip(tripId) });
    },
  });
}
