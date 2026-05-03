/**
 * Single source of truth for the live group breakdown shown on the trip
 * card pill, the trip-detail hero pill, and the Edit Rally "Who's invited?"
 * badge. Mirrors GroupSection.tsx's participant-∪-orphan-respondent merge
 * so the headline count and per-row badges always line up.
 *
 * Buckets (per merged member):
 *   accepted = is_planner || rsvp === 'in'
 *   declined = rsvp === 'out'
 *   pending  = no rsvp decision yet (and not the planner)
 *
 * Excluded from the count entirely:
 *   participant.status ∈ {opted_out, removed_by_planner, inactive}
 *
 * Orphan respondents — people who answered the share-link survey but
 * never landed in trip_session_participants (e.g. share-link-only flow,
 * or the SMS session hadn't been created yet) — are included so the
 * count doesn't undershoot what Edit Rally lists.
 */
import { normalizePhone } from '@/lib/phone';

interface ParticipantLike {
  status: string;
  is_attending: boolean | null;
  is_planner?: boolean | null;
  phone: string;
}

interface RespondentLike {
  phone: string | null;
  rsvp: string | null;
  is_planner?: boolean | null;
}

export interface MemberAttendanceCounts {
  /** Planner + members who explicitly RSVP'd 'in'. */
  acceptedCount: number;
  /** Active members with no RSVP decision yet. */
  pendingCount: number;
  /** Members who explicitly RSVP'd 'out'. */
  declinedCount: number;
  /** accepted + pending + declined — "people currently in the group". */
  invitedCount: number;
}

// Mirrors GroupSection.tsx: only members who texted STOP or were
// kicked are excluded. 'inactive' (dormant participants who haven't
// touched the SMS thread but aren't opted out) is still counted —
// they're in the group, just quiet.
const EXCLUDED_PARTICIPANT_STATUSES = new Set([
  'opted_out',
  'removed_by_planner',
]);

export function computeMemberAttendanceCounts(
  participants: ParticipantLike[],
  respondents: RespondentLike[],
): MemberAttendanceCounts {
  // Index respondent rsvp + planner flag by normalized phone — both for
  // looking up a participant's survey state and for spotting orphan
  // respondents (rsvp set but no matching participant row).
  type RespondentEntry = { rsvp: string | null; isPlanner: boolean };
  const respByPhone = new Map<string, RespondentEntry>();
  for (const r of respondents) {
    const norm = normalizePhone(r.phone) ?? r.phone;
    if (!norm) continue;
    respByPhone.set(norm, { rsvp: r.rsvp ?? null, isPlanner: r.is_planner === true });
  }

  let acceptedCount = 0;
  let pendingCount = 0;
  let declinedCount = 0;
  const seen = new Set<string>();

  function classify(rsvp: string | null, isPlanner: boolean) {
    if (rsvp === 'out') declinedCount += 1;
    else if (isPlanner || rsvp === 'in') acceptedCount += 1;
    else pendingCount += 1;
  }

  for (const p of participants) {
    if (EXCLUDED_PARTICIPANT_STATUSES.has(p.status)) continue;
    const norm = normalizePhone(p.phone) ?? p.phone;
    if (!norm) continue;
    seen.add(norm);
    const r = respByPhone.get(norm);
    classify(r?.rsvp ?? null, p.is_planner === true || r?.isPlanner === true);
  }

  // Orphan respondents — answered the survey but aren't in the SMS roster.
  // GroupSection adds these to its "Who's invited" list, so we mirror that
  // here to keep the counts consistent.
  for (const [phone, entry] of respByPhone) {
    if (seen.has(phone)) continue;
    classify(entry.rsvp, entry.isPlanner);
  }

  return {
    acceptedCount,
    pendingCount,
    declinedCount,
    invitedCount: acceptedCount + pendingCount + declinedCount,
  };
}

/**
 * "8 people · 2 in, 5 pending, 1 declined" — always includes the
 * breakdown suffix when at least one member is in the group, so the
 * planner reads group state at a glance regardless of phase.
 *
 * Returns null when there's nothing to count (drafts, brand-new trips
 * before the SMS session settles), letting callers fall back to the
 * planner's rough group_size_* field.
 */
export function formatGroupBreakdownLabel(counts: MemberAttendanceCounts): string | null {
  const { acceptedCount, pendingCount, declinedCount, invitedCount } = counts;
  if (invitedCount === 0) return null;
  const noun = invitedCount === 1 ? 'person' : 'people';
  const parts: string[] = [];
  if (acceptedCount > 0) parts.push(`${acceptedCount} in`);
  if (pendingCount > 0) parts.push(`${pendingCount} pending`);
  if (declinedCount > 0) parts.push(`${declinedCount} declined`);
  return `${invitedCount} ${noun} · ${parts.join(', ')}`;
}
