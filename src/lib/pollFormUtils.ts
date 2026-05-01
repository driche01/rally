/**
 * Shared utility functions and constants used by poll creation (new.tsx)
 * and poll editing ([pollId]/edit.tsx) screens.
 */

import type { DateRange, BudgetRange } from '@/types/polls';

// ─── Constants ────────────────────────────────────────────────────────────────

export const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

export const DAY_NAMES = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

export const DURATION_OPTIONS = [
  '1 day', '2 days', '3 days', '1 week', '10 days', '2 weeks',
];

export const DEFAULT_BUDGET_RANGES: BudgetRange[] = [
  { id: 'b0', label: 'Under $500',   max: 500,  selected: true, labelOverridden: false },
  { id: 'b1', label: '$500 – $1k',   max: 1000, selected: true, labelOverridden: false },
  { id: 'b2', label: '$1k – $2.5k',  max: 2500, selected: true, labelOverridden: false },
  { id: 'b3', label: 'Above $2.5k',  max: null, selected: true, labelOverridden: false },
];

// ─── Date helpers ─────────────────────────────────────────────────────────────

/**
 * Format a YYYY-MM-DD pair as a compact human range:
 *   "May 8"               (single day, end null or equal)
 *   "May 8–9"             (same month)
 *   "May 31 – Jun 2"      (cross-month)
 */
export function formatTripDateRange(startIso: string, endIso: string | null): string {
  const s = new Date(startIso + 'T12:00:00');
  const sm = MONTH_NAMES[s.getMonth()];
  const sd = s.getDate();
  if (!endIso || endIso === startIso) return `${sm} ${sd}`;
  const e = new Date(endIso + 'T12:00:00');
  const em = MONTH_NAMES[e.getMonth()];
  const ed = e.getDate();
  return sm === em ? `${sm} ${sd}–${ed}` : `${sm} ${sd} – ${em} ${ed}`;
}

export function stripTime(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function fmtShort(d: Date): string {
  return `${MONTH_NAMES[d.getMonth()]} ${d.getDate()}`;
}

export function fmtRange(r: DateRange): string {
  if (isSameDay(r.start, r.end)) return fmtShort(r.start);
  if (r.start.getMonth() === r.end.getMonth())
    return `${fmtShort(r.start)}–${r.end.getDate()}`;
  return `${fmtShort(r.start)} – ${fmtShort(r.end)}`;
}

export function chunkArray<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size));
  return result;
}

// ─── Budget helpers ───────────────────────────────────────────────────────────

export function formatMoney(n: number): string {
  if (n >= 1000 && n % 1000 === 0) return `$${n / 1000}k`;
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${n}`;
}

export function generateRangeLabel(min: number | null, max: number | null): string {
  if (min === null && max !== null) return `Under ${formatMoney(max)}`;
  if (max === null && min !== null) return `Above ${formatMoney(min)}`;
  if (min !== null && max !== null) return `${formatMoney(min)} – ${formatMoney(max)}`;
  return 'Any budget';
}

export function getMinForRange(i: number, ranges: BudgetRange[]): number | null {
  return i === 0 ? null : ranges[i - 1].max;
}

// ─── Budget parser (used by edit screen to reconstruct ranges from DB labels) ─

export function parseMoney(s: string): number | null {
  const m = s.match(/^\$(\d+(?:\.\d+)?)(k?)$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return m[2] === 'k' ? n * 1000 : n;
}

export function parseBudgetMax(label: string): number | null {
  if (/^(Above|Over) /i.test(label)) return null;
  const matches = [...label.matchAll(/\$\d+(?:\.\d+)?k?/g)];
  if (!matches.length) return null;
  return parseMoney(matches[matches.length - 1][0]);
}

// ─── Date range parser (used by edit screen to reconstruct ranges from DB labels) ─

const MONTH_ABBR_MAP: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};

export function parseDateRangeLabel(label: string): DateRange | null {
  const now = new Date();
  const y = now.getFullYear();

  // "Mar 15 – Apr 2"
  let m = label.match(/^([A-Z][a-z]+)\s+(\d+)\s+–\s+([A-Z][a-z]+)\s+(\d+)$/);
  if (m && MONTH_ABBR_MAP[m[1]] !== undefined && MONTH_ABBR_MAP[m[3]] !== undefined) {
    const s = new Date(y, MONTH_ABBR_MAP[m[1]], Number(m[2]));
    const e = new Date(y, MONTH_ABBR_MAP[m[3]], Number(m[4]));
    if (e < now) { s.setFullYear(y + 1); e.setFullYear(y + 1); }
    return { start: s, end: e };
  }

  // "Mar 15–20" (same month, compact)
  m = label.match(/^([A-Z][a-z]+)\s+(\d+)–(\d+)$/);
  if (m && MONTH_ABBR_MAP[m[1]] !== undefined) {
    const mo = MONTH_ABBR_MAP[m[1]];
    const s = new Date(y, mo, Number(m[2]));
    const e = new Date(y, mo, Number(m[3]));
    if (e < now) { s.setFullYear(y + 1); e.setFullYear(y + 1); }
    return { start: s, end: e };
  }

  // "Mar 15" (single day)
  m = label.match(/^([A-Z][a-z]+)\s+(\d+)$/);
  if (m && MONTH_ABBR_MAP[m[1]] !== undefined) {
    const d = new Date(y, MONTH_ABBR_MAP[m[1]], Number(m[2]));
    if (d < now) d.setFullYear(y + 1);
    return { start: d, end: d };
  }

  return null;
}

// ─── Poll display order ──────────────────────────────────────────────────────

/** Canonical title of the duration poll — lets us sort it as its own slot
 *  even though it lives under the generic 'custom' type. Kept in sync with
 *  the constant in trips/new.tsx and the migrations that seed it. */
export const DURATION_POLL_TITLE = 'How long should the trip be?';

/**
 * Sort key matching the order fields appear on the new-trip form
 * (destination → duration → dates → budget → other custom). Polls table
 * positions are assigned by insertion order during creation, which mixes
 * live polls (created inside createTrip) with decided polls (created by
 * syncTripFieldsToPolls afterwards) — so ordering by `position` alone
 * doesn't reflect the form layout. Use this comparator wherever the
 * planner-facing list should mirror the create flow.
 */
export function comparePollsByFormOrder(
  a: { type: string; title: string; position?: number },
  b: { type: string; title: string; position?: number },
): number {
  const ka = pollFormSortKey(a);
  const kb = pollFormSortKey(b);
  if (ka !== kb) return ka - kb;
  // Preserve original DB ordering on ties (the public RPC already orders
  // by position but doesn't return the field). Stable sort makes 0 a
  // safe fallback.
  return (a.position ?? 0) - (b.position ?? 0);
}

function pollFormSortKey(p: { type: string; title: string }): number {
  if (p.type === 'destination') return 0;
  if (p.type === 'custom' && p.title === DURATION_POLL_TITLE) return 1;
  if (p.type === 'dates') return 2;
  if (p.type === 'budget') return 3;
  if (p.type === 'custom') return 4;
  return 99;
}
