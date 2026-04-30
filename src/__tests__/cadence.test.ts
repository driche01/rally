import {
  computeCadence,
  daysUntil,
  deriveResponsesDue,
  formatCadenceDate,
  nudgeKindLabel,
  type NudgeKind,
} from '../lib/cadence';

const DAY_MS = 24 * 60 * 60 * 1000;

function isoDate(d: Date): string { return d.toISOString().slice(0, 10); }
function daysFromNow(n: number): string { return isoDate(new Date(Date.now() + n * DAY_MS)); }

describe('deriveResponsesDue', () => {
  it('subtracts 3 days', () => {
    expect(deriveResponsesDue('2026-06-15')).toBe('2026-06-12');
  });

  it('handles month boundaries', () => {
    expect(deriveResponsesDue('2026-07-01')).toBe('2026-06-28');
  });

  it('handles year boundaries', () => {
    expect(deriveResponsesDue('2027-01-02')).toBe('2026-12-30');
  });

  it('returns null for null input', () => {
    expect(deriveResponsesDue(null)).toBeNull();
  });
});

describe('daysUntil', () => {
  it('returns null for null', () => {
    expect(daysUntil(null)).toBeNull();
  });

  it('returns 0 for today', () => {
    expect(daysUntil(daysFromNow(0))).toBe(0);
  });

  it('returns positive for future dates', () => {
    expect(daysUntil(daysFromNow(7))).toBe(7);
  });

  it('returns negative for past dates', () => {
    expect(daysUntil(daysFromNow(-3))).toBe(-3);
  });
});

describe('computeCadence — happy path (3-week book-by)', () => {
  // launch_at + 21 days from launch as responses_due → expect heartbeats
  const launchAt = '2026-05-01T16:00:00.000Z';
  const responsesDue = '2026-05-22'; // 21 days from launch

  it('returns initial + d1 + d3 + rd-2 + rd-1 (no heartbeats — gap < 21 days)', () => {
    const items = computeCadence({ launchAt, responsesDueDate: responsesDue });
    const kinds = items.map((i) => i.kind);
    expect(kinds).toEqual(['initial', 'd1', 'd3', 'rd_minus_2', 'rd_minus_1']);
  });

  it('numbers ordinals 0,1,2,3,4 in order', () => {
    const items = computeCadence({ launchAt, responsesDueDate: responsesDue });
    expect(items.map((i) => i.ordinal)).toEqual([0, 1, 2, 3, 4]);
  });

  it('schedules d1 24h after launch and d3 72h after launch', () => {
    const items = computeCadence({ launchAt, responsesDueDate: responsesDue });
    const launchMs = new Date(launchAt).getTime();
    expect(new Date(items[1].scheduledFor).getTime() - launchMs).toBe(1 * DAY_MS);
    expect(new Date(items[2].scheduledFor).getTime() - launchMs).toBe(3 * DAY_MS);
  });

  it('schedules rd-2 and rd-1 relative to responses_due', () => {
    const items = computeCadence({ launchAt, responsesDueDate: responsesDue });
    const dueMs = new Date(responsesDue + 'T16:00:00.000Z').getTime();
    expect(dueMs - new Date(items[3].scheduledFor).getTime()).toBe(2 * DAY_MS);
    expect(dueMs - new Date(items[4].scheduledFor).getTime()).toBe(1 * DAY_MS);
  });
});

describe('computeCadence — far-out book-by inserts heartbeats', () => {
  it('inserts ~one heartbeat for a 6-week window', () => {
    // launch + 42 days (6 weeks). After d3 (=launch+3), the gap to rd-2
    // (=launch+40) is 37 days — exceeds the 21-day heartbeat threshold.
    // Expect exactly one heartbeat at launch + 3 + 21 = launch + 24 days.
    const launchAt = '2026-05-01T16:00:00.000Z';
    const dueDate = '2026-06-12'; // 42 days from launch
    const items = computeCadence({ launchAt, responsesDueDate: dueDate });
    const heartbeats = items.filter((i) => i.kind === 'heartbeat');
    expect(heartbeats.length).toBe(1);

    // Heartbeat fires at d3 + 21 days
    const launchMs = new Date(launchAt).getTime();
    expect(new Date(heartbeats[0].scheduledFor).getTime()).toBe(launchMs + (3 + 21) * DAY_MS);
  });

  it('inserts multiple heartbeats for a 12-week window', () => {
    const launchAt = '2026-05-01T16:00:00.000Z';
    const dueDate = '2026-07-24'; // ~84 days from launch
    const items = computeCadence({ launchAt, responsesDueDate: dueDate });
    const heartbeats = items.filter((i) => i.kind === 'heartbeat');
    expect(heartbeats.length).toBeGreaterThanOrEqual(2);
  });
});

describe('computeCadence — collapse window for tight book-by', () => {
  it('collapses overlapping nudges when book-by is too close', () => {
    // launch + 4 days. responses_due = launch + 4. So:
    //   d3 (launch+3) and rd-1 (launch+3) collide → collapse to one
    //   d1 (launch+1) survives separately
    //   rd-2 (launch+2) overlaps with d3 (launch+3)? gap is 24h > 12h → don't collapse
    const launchAt = '2026-05-01T16:00:00.000Z';
    const dueDate = '2026-05-05'; // launch + 4 days
    const items = computeCadence({ launchAt, responsesDueDate: dueDate });
    const kinds = items.map((i) => i.kind);
    // Initial always present
    expect(kinds[0]).toBe('initial');
    // No duplicate timestamps — collapse window is enforced
    const times = items.map((i) => i.scheduledFor);
    const unique = new Set(times);
    expect(unique.size).toBe(times.length);
  });

  it('drops items scheduled before launch', () => {
    // responses_due in the past relative to launch — rd-2 / rd-1 land before launch
    const launchAt = '2026-05-01T16:00:00.000Z';
    const dueDate = '2026-05-01'; // same day as launch
    const items = computeCadence({ launchAt, responsesDueDate: dueDate });
    const launchMs = new Date(launchAt).getTime();
    // No item should be more than 12h before launch (collapse window slack)
    for (const it of items) {
      expect(new Date(it.scheduledFor).getTime()).toBeGreaterThanOrEqual(launchMs - 12 * 60 * 60 * 1000);
    }
  });
});

describe('computeCadence — fireHourUtc override', () => {
  it('respects custom fire hour for nudges (initial fires at exact launch)', () => {
    const items = computeCadence({
      launchAt: '2026-05-01T08:00:00.000Z',
      responsesDueDate: '2026-05-22',
      fireHourUtc: 20,
    });
    for (const it of items) {
      if (it.kind === 'initial') {
        // Initial outreach fires at the exact launch moment, never snapped.
        expect(new Date(it.scheduledFor).toISOString()).toBe('2026-05-01T08:00:00.000Z');
      } else {
        expect(new Date(it.scheduledFor).getUTCHours()).toBe(20);
      }
    }
  });

  it('initial fires immediately at launch regardless of fire hour', () => {
    const launchAt = '2026-05-01T08:30:00.000Z';
    const items = computeCadence({
      launchAt,
      responsesDueDate: '2026-05-22',
    });
    const initial = items.find((it) => it.kind === 'initial');
    expect(initial?.scheduledFor).toBe(launchAt);
  });
});

describe('formatCadenceDate', () => {
  it('renders "Day Mon DD"', () => {
    // 2026-05-15 is a Friday
    const out = formatCadenceDate('2026-05-15T16:00:00.000Z');
    expect(out).toMatch(/^[A-Z][a-z]{2} [A-Z][a-z]{2} \d{1,2}$/);
  });
});

describe('nudgeKindLabel', () => {
  const cases: NudgeKind[] = ['initial', 'd1', 'd3', 'heartbeat', 'rd_minus_2', 'rd_minus_1'];
  it.each(cases)('returns a non-empty label for %s', (kind) => {
    const label = nudgeKindLabel(kind);
    expect(typeof label).toBe('string');
    expect(label.length).toBeGreaterThan(0);
  });
});
