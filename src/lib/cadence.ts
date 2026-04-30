/**
 * Nudge cadence — deterministic schedule keyed off a trip's responses-due date.
 *
 * The same shape is used in three places: (1) the cadence preview in the
 * planner setup flow, (2) the cadence schedule card on the dashboard,
 * (3) the sms-nudge-scheduler edge function. Keep this pure and free of
 * React / Supabase imports so the edge function can import the equivalent
 * Deno port without runtime drift.
 *
 * Cadence (spec):
 *   d0           — launch_at                       (initial outreach)
 *   d1           — launch_at + 24h                 (first nudge)
 *   d3           — launch_at + 72h                 (second nudge)
 *   heartbeat    — every 21 days during quiet      (only if quiet > 21d)
 *   rd_minus_2   — responses_due - 48h             (third nudge)
 *   rd_minus_1   — responses_due - 24h             (final / "last call")
 *
 * Adjacent items within ~12h of each other collapse to the later one
 * (avoids spamming when book_by is close).
 */

export type NudgeKind =
  | 'initial'
  | 'd1'
  | 'd3'
  | 'heartbeat'
  | 'rd_minus_2'
  | 'rd_minus_1';

export interface CadenceItem {
  kind: NudgeKind;
  /** Scheduled time as ISO 8601 (UTC). */
  scheduledFor: string;
  /** Index for display (1 = first user-visible nudge after the initial send). */
  ordinal: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const HEARTBEAT_INTERVAL_MS = 21 * DAY_MS;
const COLLAPSE_WINDOW_MS = 12 * 60 * 60 * 1000;

interface ComputeArgs {
  /** When the trip is launched (defaults to now). ISO string or Date. */
  launchAt?: Date | string;
  /** Internal deadline. ISO 'YYYY-MM-DD' or Date. */
  responsesDueDate: Date | string;
  /** Hour-of-day (UTC) to fire each nudge. Defaults to 16 (noon ET). */
  fireHourUtc?: number;
}

function toDate(v: Date | string): Date {
  return v instanceof Date ? v : new Date(v);
}

function atHour(d: Date, hourUtc: number): Date {
  const out = new Date(d);
  out.setUTCHours(hourUtc, 0, 0, 0);
  return out;
}

/**
 * Compute the full nudge schedule for a single (participant, trip) instance.
 * Returns items sorted by scheduledFor ascending. The 'initial' item is
 * included in the array (ordinal 0) so callers can choose to display it
 * or filter it out.
 */
export function computeCadence(args: ComputeArgs): CadenceItem[] {
  // Initial outreach fires at the *exact* launch moment (no fire-hour
  // snap) — the planner expects every contact to get the first text
  // immediately when the trip is created, not later that day at noon ET.
  // All subsequent nudges (d1, d3, rd-2, rd-1) still snap to fireHourUtc
  // so they land at a predictable, polite time of day.
  const rawLaunch = toDate(args.launchAt ?? new Date());
  const launch = atHour(rawLaunch, args.fireHourUtc ?? 16);
  const due = atHour(toDate(args.responsesDueDate), args.fireHourUtc ?? 16);

  const proposed: CadenceItem[] = [
    { kind: 'initial',    scheduledFor: rawLaunch.toISOString(),                         ordinal: 0 },
    { kind: 'd1',         scheduledFor: new Date(launch.getTime() + 1 * DAY_MS).toISOString(), ordinal: 1 },
    { kind: 'd3',         scheduledFor: new Date(launch.getTime() + 3 * DAY_MS).toISOString(), ordinal: 2 },
    { kind: 'rd_minus_2', scheduledFor: new Date(due.getTime()    - 2 * DAY_MS).toISOString(), ordinal: 3 },
    { kind: 'rd_minus_1', scheduledFor: new Date(due.getTime()    - 1 * DAY_MS).toISOString(), ordinal: 4 },
  ];

  // Heartbeat insertion: if the gap between d3 and rd_minus_2 exceeds
  // 21 days, drop heartbeat pings every ~21 days during the quiet stretch.
  const d3Time = new Date(launch.getTime() + 3 * DAY_MS).getTime();
  const rdMinus2Time = new Date(due.getTime() - 2 * DAY_MS).getTime();
  if (rdMinus2Time - d3Time > HEARTBEAT_INTERVAL_MS) {
    let hb = d3Time + HEARTBEAT_INTERVAL_MS;
    while (hb < rdMinus2Time - COLLAPSE_WINDOW_MS) {
      proposed.push({ kind: 'heartbeat', scheduledFor: new Date(hb).toISOString(), ordinal: 0 });
      hb += HEARTBEAT_INTERVAL_MS;
    }
  }

  // Sort by time, drop anything in the past relative to launch (e.g. when
  // book_by is so close that rd_minus_2 lands before launch), and collapse
  // adjacent items within COLLAPSE_WINDOW_MS — preferring the later kind
  // (the "later" nudge is more urgent and informative).
  const sorted = proposed
    .filter((it) => new Date(it.scheduledFor).getTime() >= launch.getTime() - COLLAPSE_WINDOW_MS)
    .sort((a, b) => new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime());

  const collapsed: CadenceItem[] = [];
  for (const item of sorted) {
    const last = collapsed[collapsed.length - 1];
    if (last && new Date(item.scheduledFor).getTime() - new Date(last.scheduledFor).getTime() < COLLAPSE_WINDOW_MS) {
      // Replace the earlier item with this later one (more urgent kind wins).
      collapsed[collapsed.length - 1] = item;
    } else {
      collapsed.push(item);
    }
  }

  // Renumber ordinals after collapse.
  let ord = 0;
  return collapsed.map((it) => ({ ...it, ordinal: it.kind === 'initial' ? 0 : ++ord }));
}

/**
 * Days between today (UTC midnight) and the given date string. Negative
 * if the date is in the past.
 */
export function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const target = new Date(dateStr);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  target.setUTCHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / DAY_MS);
}

/**
 * Default responses-due derivation: book_by - 3 days. Returns null if
 * input is null. Pure date math — no timezone surprises.
 */
export function deriveResponsesDue(bookByDate: string | null): string | null {
  if (!bookByDate) return null;
  const d = new Date(bookByDate);
  d.setUTCDate(d.getUTCDate() - 3);
  return d.toISOString().slice(0, 10);
}

/**
 * Human-readable date for cadence preview, e.g. "Mon May 12".
 * Month + day only (no year) — preview is always for the near-ish future.
 */
export function formatCadenceDate(iso: string): string {
  const d = new Date(iso);
  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${days[d.getDay()]} ${months[d.getMonth()]} ${d.getDate()}`;
}

/**
 * Friendly label for a nudge kind, used in dashboard + setup preview.
 */
export function nudgeKindLabel(kind: NudgeKind): string {
  switch (kind) {
    case 'initial':    return 'Initial outreach';
    case 'd1':         return 'First nudge';
    case 'd3':         return 'Second nudge';
    case 'heartbeat':  return 'Check-in';
    case 'rd_minus_2': return 'Reminder';
    case 'rd_minus_1': return 'Last call';
  }
}
