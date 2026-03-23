/**
 * API functions for F1 AI suggestions — lodging and travel.
 */

import { supabase } from '../supabase';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface LodgingSuggestion {
  index: number;
  label: string;
  description: string;
  propertyType: string;
  idealFor: string;
  estimatedNightlyRate: string | null;
  platforms: ('airbnb' | 'vrbo' | 'booking')[];
  airbnbUrl: string | null;
  vrboUrl: string | null;
  bookingUrl: string | null;
}

export interface TravelSuggestion {
  index: number;
  mode: 'flight' | 'train' | 'car' | 'ferry' | 'bus' | 'other';
  label: string;
  description: string;
  estimatedDuration: string;
  estimatedCostPerPerson: string | null;
  pros: string[];
  cons: string[];
  searchUrl: string;
  bookingTip: string | null;
}

// ─── Lodging suggestions ───────────────────────────────────────────────────────

export async function getLodgingSuggestions(
  tripId: string
): Promise<LodgingSuggestion[]> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('No active session');

  const { data, error } = await supabase.functions.invoke('suggest-lodging', {
    body: { trip_id: tripId },
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (error) throw error;
  return (data as { suggestions: LodgingSuggestion[] }).suggestions ?? [];
}

// ─── Travel suggestions ────────────────────────────────────────────────────────

export async function getTravelSuggestions(
  tripId: string,
  origin?: string
): Promise<TravelSuggestion[]> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('No active session');

  const { data, error } = await supabase.functions.invoke('suggest-travel', {
    body: { trip_id: tripId, origin: origin ?? null },
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (error) throw error;
  return (data as { suggestions: TravelSuggestion[] }).suggestions ?? [];
}
