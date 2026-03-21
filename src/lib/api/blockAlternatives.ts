import { supabase } from '../supabase';
import type { AiBlockAlternative, ItineraryBlock } from '../../types/database';

export interface SuggestBlockAlternativesInput {
  tripId: string;
  block: Pick<ItineraryBlock, 'type' | 'title' | 'start_time' | 'end_time' | 'location' | 'notes' | 'day_date'>;
  existingAlternatives?: AiBlockAlternative[];
  userPrompt?: string;
}

export async function suggestBlockAlternatives(
  input: SuggestBlockAlternativesInput
): Promise<AiBlockAlternative[]> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('No active session');

  const { data, error } = await supabase.functions.invoke('suggest-block-alternatives', {
    body: {
      trip_id: input.tripId,
      block: input.block,
      existing_alternatives: input.existingAlternatives ?? [],
      user_prompt: input.userPrompt ?? null,
    },
    headers: { Authorization: `Bearer ${session.access_token}` },
  });

  if (error) throw error;
  if (!data?.alternatives) throw new Error('No alternatives returned');
  return data.alternatives as AiBlockAlternative[];
}
