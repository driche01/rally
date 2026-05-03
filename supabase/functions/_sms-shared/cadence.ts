/**
 * Nudge cadence — Deno-side mirror of src/lib/cadence.ts.
 *
 * Kept as a separate file (not imported across the RN/Deno boundary) because
 * Supabase edge functions run in Deno and use URL imports for npm packages,
 * while the RN bundle uses Metro. The math is pure — keep both files in
 * sync if you change one. Tests in supabase/functions/tests cover the
 * Deno port; src/__tests__ covers the RN port.
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
  scheduledFor: string;
  ordinal: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const HEARTBEAT_INTERVAL_MS = 21 * DAY_MS;
const COLLAPSE_WINDOW_MS = 12 * 60 * 60 * 1000;

interface ComputeArgs {
  launchAt?: Date | string;
  responsesDueDate: Date | string;
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

export function computeCadence(args: ComputeArgs): CadenceItem[] {
  // Initial outreach fires at the *exact* launch moment (no fire-hour
  // snap) — the planner expects every contact to get the first text
  // immediately when the trip is created. Subsequent nudges still snap
  // to fireHourUtc so they land at a polite, predictable time of day.
  const rawLaunch = toDate(args.launchAt ?? new Date());
  const launch = atHour(rawLaunch, args.fireHourUtc ?? 16);
  const due = atHour(toDate(args.responsesDueDate), args.fireHourUtc ?? 16);

  const proposed: CadenceItem[] = [
    { kind: 'initial',    scheduledFor: rawLaunch.toISOString(),                               ordinal: 0 },
    { kind: 'd1',         scheduledFor: new Date(launch.getTime() + 1 * DAY_MS).toISOString(), ordinal: 1 },
    { kind: 'd3',         scheduledFor: new Date(launch.getTime() + 3 * DAY_MS).toISOString(), ordinal: 2 },
    { kind: 'rd_minus_2', scheduledFor: new Date(due.getTime()    - 2 * DAY_MS).toISOString(), ordinal: 3 },
    { kind: 'rd_minus_1', scheduledFor: new Date(due.getTime()    - 1 * DAY_MS).toISOString(), ordinal: 4 },
  ];

  const d3Time = new Date(launch.getTime() + 3 * DAY_MS).getTime();
  const rdMinus2Time = new Date(due.getTime() - 2 * DAY_MS).getTime();
  if (rdMinus2Time - d3Time > HEARTBEAT_INTERVAL_MS) {
    let hb = d3Time + HEARTBEAT_INTERVAL_MS;
    while (hb < rdMinus2Time - COLLAPSE_WINDOW_MS) {
      proposed.push({ kind: 'heartbeat', scheduledFor: new Date(hb).toISOString(), ordinal: 0 });
      hb += HEARTBEAT_INTERVAL_MS;
    }
  }

  const sorted = proposed
    .filter((it) => new Date(it.scheduledFor).getTime() >= launch.getTime() - COLLAPSE_WINDOW_MS)
    .sort((a, b) => new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime());

  const collapsed: CadenceItem[] = [];
  for (const item of sorted) {
    const last = collapsed[collapsed.length - 1];
    if (last && new Date(item.scheduledFor).getTime() - new Date(last.scheduledFor).getTime() < COLLAPSE_WINDOW_MS) {
      collapsed[collapsed.length - 1] = item;
    } else {
      collapsed.push(item);
    }
  }

  let ord = 0;
  return collapsed.map((it) => ({ ...it, ordinal: it.kind === 'initial' ? 0 : ++ord }));
}

export function deriveResponsesDue(bookByDate: string | null): string | null {
  if (!bookByDate) return null;
  const d = new Date(bookByDate);
  d.setUTCDate(d.getUTCDate() - 3);
  return d.toISOString().slice(0, 10);
}

/**
 * Default grace window for the late-joiner cadence filter. Items whose
 * `scheduledFor` falls within this window of the participant's join
 * time still fire. A new member added 6 hours after launch should still
 * get d1 even if d1 technically fell a few hours before they joined.
 */
export const LATE_JOINER_GRACE_MS = 12 * 60 * 60 * 1000;

/**
 * Filter trip-anchored cadence items down to those that still apply to a
 * participant given when they joined. Used by `seedSession` to keep the
 * group's cadence in lockstep (everyone shares the same launch anchor)
 * while not firing stale nudges to a late-add member.
 *
 * - For a planner / fresh-trip member, joinedAt ≈ launchAt → all items
 *   pass through (the filter window includes everything from
 *   joinedAt - 12h forward).
 * - For a late joiner, items already in the past (e.g. an `initial`
 *   anchored at launch when they joined 5 days later) are dropped — the
 *   welcome SMS is the responsibility of `member-add`, not the cadence.
 *
 * Returns the input items unchanged when joinedAt is missing/invalid.
 */
export function filterCadenceForJoiner(
  items: CadenceItem[],
  joinedAt: Date | string | null | undefined,
  graceMs: number = LATE_JOINER_GRACE_MS,
): CadenceItem[] {
  if (!joinedAt) return items;
  const joinedMs = (joinedAt instanceof Date ? joinedAt : new Date(joinedAt)).getTime();
  if (Number.isNaN(joinedMs)) return items;
  const cutoff = joinedMs - graceMs;
  return items.filter((it) => new Date(it.scheduledFor).getTime() >= cutoff);
}
