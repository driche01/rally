/**
 * Unit tests for pure utility functions in itinerary.ts
 * (buildItineraryDays, formatDayLabel, formatTime, generateIcal)
 *
 * Supabase is mocked — no network calls are made.
 */

jest.mock('../lib/supabase', () => ({
  supabase: {
    from: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      delete: jest.fn().mockReturnThis(),
      upsert: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: null, error: null }),
    })),
  },
}));

import {
  buildItineraryDays,
  formatDayLabel,
  formatTime,
  generateIcal,
} from '../lib/api/itinerary';
import type { ItineraryBlock, DayRsvp } from '../types/database';

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeBlock(overrides: Partial<ItineraryBlock> = {}): ItineraryBlock {
  return {
    id: 'b1',
    trip_id: 't1',
    day_date: '2025-06-15',
    type: 'activity',
    title: 'Hike',
    start_time: '09:00',
    end_time: '12:00',
    location: 'Trailhead',
    notes: 'Bring water',
    position: 0,
    attendee_ids: null,
    lodging_option_id: null,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeRsvp(overrides: Partial<DayRsvp> = {}): DayRsvp {
  return {
    id: 'rsvp1',
    trip_id: 't1',
    respondent_id: 'r1',
    day_date: '2025-06-15',
    status: 'going',
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

// ─── buildItineraryDays ───────────────────────────────────────────────────────

describe('buildItineraryDays', () => {
  it('generates one ItineraryDay per calendar day in range', () => {
    const days = buildItineraryDays('2025-06-15', '2025-06-17', [], []);
    expect(days).toHaveLength(3);
    expect(days[0].date).toBe('2025-06-15');
    expect(days[1].date).toBe('2025-06-16');
    expect(days[2].date).toBe('2025-06-17');
  });

  it('handles a single-day trip', () => {
    const days = buildItineraryDays('2025-07-04', '2025-07-04', [], []);
    expect(days).toHaveLength(1);
    expect(days[0].date).toBe('2025-07-04');
  });

  it('buckets blocks into the correct day', () => {
    const blocks = [
      makeBlock({ day_date: '2025-06-15', title: 'Day 1 activity' }),
      makeBlock({ id: 'b2', day_date: '2025-06-16', title: 'Day 2 activity' }),
    ];
    const days = buildItineraryDays('2025-06-15', '2025-06-16', blocks, []);
    expect(days[0].blocks).toHaveLength(1);
    expect(days[0].blocks[0].title).toBe('Day 1 activity');
    expect(days[1].blocks).toHaveLength(1);
    expect(days[1].blocks[0].title).toBe('Day 2 activity');
  });

  it('returns empty blocks array for days with no blocks', () => {
    const days = buildItineraryDays('2025-07-01', '2025-07-03', [], []);
    expect(days.every((d) => d.blocks.length === 0)).toBe(true);
  });

  it('counts RSVPs per day per status', () => {
    const rsvps = [
      makeRsvp({ status: 'going' }),
      makeRsvp({ id: 'rsvp2', respondent_id: 'r2', status: 'going' }),
      makeRsvp({ id: 'rsvp3', respondent_id: 'r3', status: 'cant_make_it' }),
    ];
    const days = buildItineraryDays('2025-06-15', '2025-06-15', [], rsvps);
    expect(days[0].rsvpCounts.going).toBe(2);
    expect(days[0].rsvpCounts.cant_make_it).toBe(1);
    expect(days[0].rsvpCounts.not_sure).toBe(0);
  });

  it('sorts blocks with start_time before untimed blocks', () => {
    const blocks = [
      makeBlock({ id: 'b1', start_time: '14:00', position: 0, title: 'Afternoon' }),
      makeBlock({ id: 'b2', start_time: '09:00', position: 1, title: 'Morning' }),
      makeBlock({ id: 'b3', start_time: null, position: 2, title: 'Untimed' }),
    ];
    const days = buildItineraryDays('2025-06-15', '2025-06-15', blocks, []);
    expect(days[0].blocks[0].title).toBe('Morning');
    expect(days[0].blocks[1].title).toBe('Afternoon');
    expect(days[0].blocks[2].title).toBe('Untimed');
  });

  it('initializes rsvpCounts to zero when no RSVPs exist', () => {
    const days = buildItineraryDays('2025-06-15', '2025-06-15', [], []);
    const { rsvpCounts } = days[0];
    expect(rsvpCounts.going).toBe(0);
    expect(rsvpCounts.not_sure).toBe(0);
    expect(rsvpCounts.cant_make_it).toBe(0);
  });

  it('does not bucket RSVPs into the wrong day', () => {
    const rsvps = [
      makeRsvp({ day_date: '2025-06-16', status: 'going' }),
    ];
    const days = buildItineraryDays('2025-06-15', '2025-06-16', [], rsvps);
    expect(days[0].rsvpCounts.going).toBe(0);
    expect(days[1].rsvpCounts.going).toBe(1);
  });
});

// ─── formatDayLabel ───────────────────────────────────────────────────────────

describe('formatDayLabel', () => {
  it('includes the weekday abbreviation', () => {
    // 2025-06-15 is a Sunday
    const label = formatDayLabel('2025-06-15');
    expect(label).toContain('Sun');
  });

  it('includes the month abbreviation', () => {
    const label = formatDayLabel('2025-06-15');
    expect(label).toContain('Jun');
  });

  it('includes the day number', () => {
    const label = formatDayLabel('2025-06-15');
    expect(label).toContain('15');
  });

  it('handles December correctly', () => {
    // 2025-12-25 is a Thursday
    const label = formatDayLabel('2025-12-25');
    expect(label).toContain('Dec');
    expect(label).toContain('25');
    expect(label).toContain('Thu');
  });

  it('avoids DST off-by-one errors for month boundaries', () => {
    // 2025-03-01 is a Saturday (month boundary near DST change)
    const label = formatDayLabel('2025-03-01');
    expect(label).toContain('Mar');
    expect(label).toContain('1');
  });
});

// ─── formatTime ───────────────────────────────────────────────────────────────

describe('formatTime', () => {
  it('formats midnight as "12:00 AM"', () => {
    expect(formatTime('00:00')).toBe('12:00 AM');
  });

  it('formats noon as "12:00 PM"', () => {
    expect(formatTime('12:00')).toBe('12:00 PM');
  });

  it('formats 9:30 AM correctly', () => {
    expect(formatTime('09:30')).toBe('9:30 AM');
  });

  it('formats 13:45 as "1:45 PM"', () => {
    expect(formatTime('13:45')).toBe('1:45 PM');
  });

  it('formats 23:59 as "11:59 PM"', () => {
    expect(formatTime('23:59')).toBe('11:59 PM');
  });

  it('pads minutes with leading zero', () => {
    expect(formatTime('09:05')).toBe('9:05 AM');
  });

  it('returns empty string for null', () => {
    expect(formatTime(null)).toBe('');
  });
});

// ─── generateIcal ────────────────────────────────────────────────────────────

describe('generateIcal', () => {
  it('produces a valid VCALENDAR envelope', () => {
    const ical = generateIcal([], 'Test Trip');
    expect(ical).toContain('BEGIN:VCALENDAR');
    expect(ical).toContain('END:VCALENDAR');
    expect(ical).toContain('VERSION:2.0');
    expect(ical).toContain('CALSCALE:GREGORIAN');
  });

  it('includes X-WR-CALNAME with the trip name', () => {
    const ical = generateIcal([], 'Lake Tahoe 2025');
    expect(ical).toContain('X-WR-CALNAME:Lake Tahoe 2025');
  });

  it('generates one VEVENT per block', () => {
    const blocks = [makeBlock(), makeBlock({ id: 'b2', title: 'Dinner' })];
    const ical = generateIcal(blocks, 'Trip');
    const count = (ical.match(/BEGIN:VEVENT/g) ?? []).length;
    expect(count).toBe(2);
  });

  it('generates no VEVENTs for an empty block list', () => {
    const ical = generateIcal([], 'Trip');
    expect(ical).not.toContain('BEGIN:VEVENT');
  });

  it('sets timed DTSTART/DTEND correctly', () => {
    const ical = generateIcal([makeBlock()], 'Trip');
    expect(ical).toContain('DTSTART:20250615T090000');
    expect(ical).toContain('DTEND:20250615T120000');
  });

  it('uses VALUE=DATE format for all-day blocks', () => {
    const ical = generateIcal([makeBlock({ start_time: null, end_time: null })], 'Trip');
    expect(ical).toContain('DTSTART;VALUE=DATE:20250615');
    expect(ical).toContain('DTEND;VALUE=DATE:20250615');
  });

  it('includes LOCATION when present', () => {
    const ical = generateIcal([makeBlock({ location: 'Trailhead' })], 'Trip');
    expect(ical).toContain('LOCATION:Trailhead');
  });

  it('omits LOCATION when null', () => {
    const ical = generateIcal([makeBlock({ location: null })], 'Trip');
    expect(ical).not.toContain('LOCATION:');
  });

  it('includes DESCRIPTION from block notes', () => {
    const ical = generateIcal([makeBlock({ notes: 'Bring water' })], 'Trip');
    expect(ical).toContain('DESCRIPTION:Bring water');
  });

  it('escapes commas in titles per RFC 5545', () => {
    const ical = generateIcal([makeBlock({ title: 'Hike, Run, Swim' })], 'Trip');
    expect(ical).toContain('SUMMARY:Hike\\, Run\\, Swim');
  });

  it('includes the Rally UID in each event', () => {
    const ical = generateIcal([makeBlock({ id: 'block-abc' })], 'Trip');
    expect(ical).toContain('UID:rally-block-block-abc@rallyapp.io');
  });

  it('includes CATEGORIES with the block type', () => {
    const ical = generateIcal([makeBlock({ type: 'meal' })], 'Trip');
    expect(ical).toContain('CATEGORIES:MEAL');
  });
});
