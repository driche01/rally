import { useMutation } from '@tanstack/react-query';
import { suggestBlockAlternatives, type SuggestBlockAlternativesInput } from '@/lib/api/blockAlternatives';
import type { AiBlockAlternative } from '@/types/database';

/**
 * Mutation to fetch AI-generated alternatives for an itinerary block.
 * Stateless — results are returned directly and not cached in React Query.
 */
export function useSuggestBlockAlternatives() {
  return useMutation<AiBlockAlternative[], Error, SuggestBlockAlternativesInput>({
    mutationFn: suggestBlockAlternatives,
  });
}
