import { supabase } from '../supabase';
import type { ItineraryBlock, DayRsvp, DayRsvpStatus, BlockType, ItineraryDay } from '../../types/database';

// ─── Itinerary blocks ─────────────────────────────────────────────────────────

export interface CreateBlockInput {
  trip_id: string;
  day_date: string;           // 'YYYY-MM-DD'
  type: BlockType;
  title: string;
  start_time?: string | null; // 'HH:MM'
  end_time?: string | null;
  location?: string | null;
  notes?: string | null;
  position?: number;
  attendee_ids?: string[] | null;
  lodging_option_id?: string | null;
}

export async function getBlocksForTrip(tripId: string): Promise<ItineraryBlock[]> {
  const { data, error } = await supabase
    .from('itinerary_blocks')
    .select('*')
    .eq('trip_id', tripId)
    .order('day_date', { ascending: true })
    .order('position', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function createBlock(input: CreateBlockInput): Promise<ItineraryBlock> {
  const { data, error } = await supabase
    .from('itinerary_blocks')
    .insert(input)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateBlock(
  blockId: string,
  updates: Partial<Omit<CreateBlockInput, 'trip_id'>>
): Promise<ItineraryBlock> {
  const { data, error } = await supabase
    .from('itinerary_blocks')
    .update(updates)
    .eq('id', blockId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteBlock(blockId: string): Promise<void> {
  const { error } = await supabase
    .from('itinerary_blocks')
    .delete()
    .eq('id', blockId);
  if (error) throw error;
}

export async function deleteBlocksByType(tripId: string, type: BlockType): Promise<void> {
  const { error } = await supabase
    .from('itinerary_blocks')
    .delete()
    .eq('trip_id', tripId)
    .eq('type', type);
  if (error) throw error;
}

export async function reorderBlocks(
  updates: { id: string; position: number }[]
): Promise<void> {
  // Batch update positions
  const promises = updates.map(({ id, position }) =>
    supabase.from('itinerary_blocks').update({ position }).eq('id', id)
  );
  await Promise.all(promises);
}

// ─── Day RSVPs ────────────────────────────────────────────────────────────────

export async function getRsvpsForTrip(tripId: string): Promise<DayRsvp[]> {
  const { data, error } = await supabase
    .from('day_rsvps')
    .select('*')
    .eq('trip_id', tripId);
  if (error) throw error;
  return data ?? [];
}

export async function upsertDayRsvp(
  tripId: string,
  respondentId: string,
  dayDate: string,
  status: DayRsvpStatus
): Promise<DayRsvp> {
  const { data, error } = await supabase
    .from('day_rsvps')
    .upsert(
      { trip_id: tripId, respondent_id: respondentId, day_date: dayDate, status },
      { onConflict: 'trip_id,respondent_id,day_date' }
    )
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Groups blocks and RSVPs into ItineraryDay objects spanning trip start→end.
 * Days are auto-generated from the trip date range; blocks are bucketed by date.
 */
export function buildItineraryDays(
  startDate: string,
  endDate: string,
  blocks: ItineraryBlock[],
  rsvps: DayRsvp[]
): ItineraryDay[] {
  const days: ItineraryDay[] = [];

  const start = new Date(startDate + 'T00:00:00');
  const end = new Date(endDate + 'T00:00:00');

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().split('T')[0];
    const dayBlocks = blocks
      .filter((b) => b.day_date === dateStr)
      .sort((a, b) => {
        // Sort by start_time first, then position
        if (a.start_time && b.start_time) return a.start_time.localeCompare(b.start_time);
        if (a.start_time) return -1;
        if (b.start_time) return 1;
        return a.position - b.position;
      });

    const dayRsvps = rsvps.filter((r) => r.day_date === dateStr);
    const rsvpCounts = { going: 0, not_sure: 0, cant_make_it: 0 };
    dayRsvps.forEach((r) => {
      rsvpCounts[r.status] = (rsvpCounts[r.status] ?? 0) + 1;
    });

    days.push({ date: dateStr, blocks: dayBlocks, rsvpCounts });
  }

  return days;
}

/**
 * Formats 'YYYY-MM-DD' to a display label like "Fri, Feb 14"
 */
export function formatDayLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00'); // noon to avoid DST edge cases
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

/**
 * Formats 'HH:MM' to "9:00 AM"
 */
export function formatTime(time: string | null): string {
  if (!time) return '';
  const [hStr, mStr] = time.split(':');
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, '0')} ${period}`;
}

/**
 * Generates an iCal (.ics) string for a single block or the full trip.
 */
export function generateIcal(
  blocks: ItineraryBlock[],
  tripName: string
): string {
  const escape = (s: string) => s.replace(/,/g, '\\,').replace(/\n/g, '\\n');

  const events = blocks.map((block) => {
    const date = block.day_date.replace(/-/g, '');
    const uid = `rally-block-${block.id}@rallyapp.io`;

    let dtStart: string;
    let dtEnd: string;

    if (block.start_time) {
      const startTime = block.start_time.replace(':', '') + '00';
      dtStart = `${date}T${startTime}`;
      const endTime = block.end_time
        ? block.end_time.replace(':', '') + '00'
        : startTime; // same time if no end
      dtEnd = `${date}T${endTime}`;
    } else {
      dtStart = `${date}`;
      dtEnd = `${date}`;
    }

    const isAllDay = !block.start_time;
    const dtStartStr = isAllDay ? `DTSTART;VALUE=DATE:${dtStart}` : `DTSTART:${dtStart}`;
    const dtEndStr = isAllDay ? `DTEND;VALUE=DATE:${dtEnd}` : `DTEND:${dtEnd}`;

    return [
      'BEGIN:VEVENT',
      `UID:${uid}`,
      dtStartStr,
      dtEndStr,
      `SUMMARY:${escape(block.title)}`,
      block.location ? `LOCATION:${escape(block.location)}` : '',
      block.notes ? `DESCRIPTION:${escape(block.notes)}` : '',
      `CATEGORIES:${block.type.toUpperCase()}`,
      'END:VEVENT',
    ]
      .filter(Boolean)
      .join('\r\n');
  });

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Rally//Rally Trip//EN',
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${escape(tripName)}`,
    ...events,
    'END:VCALENDAR',
  ].join('\r\n');
}
