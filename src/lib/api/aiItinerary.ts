import { supabase } from '../supabase';
import type { AiItineraryDraft, AiItineraryOption } from '../../types/database';
import type { CreateBlockInput } from './itinerary';

// ─── Read ─────────────────────────────────────────────────────────────────────

export async function getAiItineraryDraft(tripId: string): Promise<AiItineraryDraft | null> {
  const { data, error } = await supabase
    .from('ai_itinerary_options')
    .select('*')
    .eq('trip_id', tripId)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

// ─── Generate ─────────────────────────────────────────────────────────────────

export async function generateAiItinerary(
  tripId: string,
  plannerOverride?: string | null
): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('No active session — please log out and log back in.');
  const { error } = await supabase.functions.invoke('generate-itinerary', {
    body: { trip_id: tripId, planner_override: plannerOverride ?? null },
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (error) throw error;
}

// ─── Apply selected option → itinerary_blocks ─────────────────────────────────

export async function applyAiItineraryOption(
  tripId: string,
  draftId: string,
  option: AiItineraryOption
): Promise<void> {
  // 1. Clear any existing blocks for this trip
  const { error: deleteError } = await supabase
    .from('itinerary_blocks')
    .delete()
    .eq('trip_id', tripId);
  if (deleteError) throw deleteError;

  // 2. Batch-insert the selected option's blocks
  const blocks: CreateBlockInput[] = [];
  for (const day of option.days) {
    day.blocks.forEach((block, position) => {
      blocks.push({
        trip_id: tripId,
        day_date: day.date,
        type: block.type as CreateBlockInput['type'],
        title: block.title,
        start_time: block.start_time ?? null,
        end_time: block.end_time ?? null,
        location: block.location ?? null,
        notes: block.notes ?? null,
        position,
      });
    });
  }

  if (blocks.length > 0) {
    const { error: insertError } = await supabase
      .from('itinerary_blocks')
      .insert(blocks);
    if (insertError) throw insertError;
  }

  // 3. Mark the draft as applied
  const { error: updateError } = await supabase
    .from('ai_itinerary_options')
    .update({
      selected_index: option.index,
      applied_at: new Date().toISOString(),
    })
    .eq('id', draftId);
  if (updateError) throw updateError;
}
