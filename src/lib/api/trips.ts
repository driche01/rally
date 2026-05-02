import { supabase, supabaseAnon } from '../supabase';
import type { GroupSizeBucket, Trip, TripWithPolls } from '../../types/database';
import { addPlannerMember } from './members';

/**
 * Fire-and-forget kick to the nudge scheduler. Useful right after a
 * trip's book_by_date changes — without this the cadence rows wouldn't
 * appear on the dashboard until the next 15-min cron tick. Best-effort:
 * never throws, never awaits the actual seed/fire work.
 */
function pokeNudgeScheduler(): void {
  // Don't await — the scheduler can take a few seconds and the user is
  // about to navigate. We just want to nudge it; the cron is the
  // source-of-truth fallback.
  supabase.functions.invoke('sms-nudge-scheduler', { body: {} }).catch(() => {});
}

export interface TripWithRespondentCount extends Trip {
  respondentCount: number;
  memberCount: number;
}

export interface CreateTripInput {
  name: string;
  group_size_bucket: GroupSizeBucket;
  /** Exact head-count; null clears a previously-stored value. */
  group_size_precise?: number | null;
  travel_window?: string;
  start_date?: string | null;
  end_date?: string | null;
  trip_type?: string | null;
  budget_per_person?: string | null;
  destination?: string | null;
  destination_address?: string | null;
  trip_duration?: string | null;
  /** External booking deadline (ISO 'YYYY-MM-DD'). Drives nudge cadence. */
  book_by_date?: string | null;
  /** Internal responses deadline (ISO). Defaults to book_by_date - 3 via DB trigger. */
  responses_due_date?: string | null;
  /** Planner override for the initial outreach SMS body. */
  custom_intro_sms?: string | null;
  /** USD per-person flight estimate; subtracted from per-person budget when sizing lodging suggestions. */
  estimated_flight_cost_per_person?: number | null;
  /**
   * Participants picked from the planner's contacts at trip creation.
   * Each one becomes a `users` row + `trip_session_participants` row, and
   * the scheduler fires their initial outreach SMS on the next tick. Phone
   * numbers are normalized server-side; rejected if normalization fails.
   * Used only on createTrip — NOT on updateTrip.
   */
  contacts?: { name: string; phone: string; email?: string | null }[];
  /**
   * Multi-option polls the planner explicitly opted into during trip
   * creation. Each entry becomes a LIVE poll on the trip with the
   * provided option labels. Single-value fields (decided polls) are
   * still set via the normal trip columns + syncTripFieldsToPolls.
   * Used only on createTrip.
   */
  poll_options?: Array<{
    type: 'destination' | 'dates' | 'budget' | 'custom';
    title: string;
    option_labels: string[];
    /**
     * Override the type-based default for `allow_multi_select`. Useful
     * for custom polls (like trip length) where the planner wants to
     * collect every duration that works for each respondent rather than
     * forcing a single pick.
     */
    allow_multi_select?: boolean;
    /**
     * When true, the poll is still created even if option_labels is empty.
     * Used for blank-destination write-in polls and (legacy) the duration
     * poll's free-form numeric mode. Only meaningful when paired with
     * either allow_write_ins (option_id responses) or for custom polls
     * that take numeric_value responses.
     */
    allow_empty_options?: boolean;
    /**
     * When true, the poll is created with `polls.allow_write_ins=true`
     * — respondents can add new options via the submit_poll_write_in
     * RPC. Used today by destination polls (when planner picks 0 chips)
     * and duration polls (always — defaults + write-in).
     */
    allow_write_ins?: boolean;
  }>;
}

export async function createTrip(input: CreateTripInput): Promise<Trip> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  // Strip non-column fields — contacts and poll_options are handled
  // separately after the trip insert.
  const { contacts, poll_options: pollOptions, ...tripFields } = input;

  const { data, error } = await supabase
    .from('trips')
    .insert({ ...tripFields, created_by: user.id })
    .select()
    .single();
  if (error) throw error;

  // Auto-enroll the creator as the planner member
  await addPlannerMember(data.id, user.id);

  // Auto-create the SMS trip_session so the dashboard cards (cadence,
  // inbox, decision queue) have something to anchor to before any
  // participant joins. Best-effort: trip creation succeeds even if the
  // session insert fails (e.g. profile.phone missing for first-time
  // users — they can join via the share link path instead).
  try {
    await supabase.rpc('app_create_sms_session', { p_trip_id: data.id });
  } catch {
    /* non-fatal — session is created lazily by join-link flow if missing */
  }

  // Insert each picked contact as a trip_session_participants row so the
  // scheduler will text them on the next tick (or on the immediate poke
  // below). Best-effort per contact — one bad phone number doesn't block
  // the rest.
  if (contacts && contacts.length > 0) {
    await addContactsAsParticipants(data.id, contacts);
  }

  // Insert each opted-in poll. Best-effort: errors logged but don't
  // block trip creation. The polls become LIVE immediately so the
  // initial outreach SMS includes them.
  if (pollOptions && pollOptions.length > 0) {
    await createLivePollsFromOptions(data.id, pollOptions);
  }

  // Kick the nudge scheduler so any participants who joined above (or
  // who join via the share link before the next cron tick) get their
  // cadence rows + initial outreach SMS immediately.
  if (data.book_by_date) pokeNudgeScheduler();

  return data;
}

/**
 * Promote each contact to an active participant on the trip's session.
 *
 * Routes through the `app_add_trip_contacts` SECURITY DEFINER RPC
 * (migration 078) so the inserts bypass the RLS write gate on
 * trip_session_participants — direct authenticated-client inserts on
 * that table are denied (only a SELECT policy exists). The RPC
 * enforces planner authorization server-side and upserts on
 * (trip_session_id, phone) so re-adding is idempotent.
 *
 * Best-effort: malformed phones are filtered client-side before the
 * RPC call; a failed RPC logs and returns without throwing.
 */
async function addContactsAsParticipants(
  tripId: string,
  contacts: { name: string; phone: string; email?: string | null }[],
): Promise<void> {
  if (contacts.length === 0) return;

  const payload: { name: string; phone: string; email: string | null }[] = [];
  for (const c of contacts) {
    const phone = normalizeUSPhone(c.phone);
    if (!phone) {
      console.warn(`[trips] addContacts: rejected phone for ${c.name}: ${c.phone}`);
      continue;
    }
    payload.push({ name: c.name, phone, email: c.email ?? null });
  }
  if (payload.length === 0) return;

  const { data, error } = await supabase.rpc('app_add_trip_contacts', {
    p_trip_id: tripId,
    p_contacts: payload,
  });
  if (error) {
    console.warn('[trips] app_add_trip_contacts failed:', error.message);
    return;
  }
  const result = data as { ok: boolean; reason?: string; added?: number; skipped?: number } | null;
  if (!result?.ok) {
    console.warn('[trips] app_add_trip_contacts not ok:', result?.reason ?? 'unknown');
  }
}

/**
 * Insert one LIVE poll per options entry the planner picked at trip
 * creation. Each poll gets its label set + options seeded in two
 * round-trips (one for the polls row, one for the bulk option insert).
 * Best-effort: on any error, log + continue.
 */
async function createLivePollsFromOptions(
  tripId: string,
  pollOptions: Array<{
    type: 'destination' | 'dates' | 'budget' | 'custom';
    title: string;
    option_labels: string[];
    allow_multi_select?: boolean;
    allow_empty_options?: boolean;
    allow_write_ins?: boolean;
  }>,
): Promise<void> {
  const { data: existing } = await supabase
    .from('polls')
    .select('id, type')
    .eq('trip_id', tripId);
  const existingTypes = new Set((existing ?? []).map((p: { type: string }) => p.type));
  let position = existing?.length ?? 0;

  for (const entry of pollOptions) {
    // For non-custom types, skip if a poll of that type already exists
    // (avoids dupes when syncTripFieldsToPolls also fires). Custom polls
    // can repeat freely.
    if (entry.type !== 'custom' && existingTypes.has(entry.type)) continue;

    // Skip empty entries. For canonical types (destination/dates/budget),
    // 1-option polls are handled by syncTripFieldsToPolls writing to the
    // trip primitive — so we still gate at <2 unless `allow_empty_options`
    // is set (e.g. blank-destination write-in polls). For custom polls
    // there's no backing primitive, so 1 option means "decided custom
    // poll". Custom polls with `allow_empty_options` (legacy duration
    // free-form mode) are created even with 0 options so respondents can
    // submit a numeric_value response.
    if (entry.type === 'custom') {
      if (entry.option_labels.length < 1 && !entry.allow_empty_options) continue;
    } else {
      if (entry.option_labels.length < 2 && !entry.allow_empty_options) continue;
    }

    const isDecided = entry.option_labels.length === 1 && !entry.allow_write_ins;
    const isFreeForm = entry.option_labels.length === 0 && !entry.allow_write_ins;

    // Default multi-select rule by poll type:
    //   destination + dates → multi-select (pick every option that works)
    //   custom + budget    → single-select (typical "pick one" semantics)
    // Caller can override via entry.allow_multi_select — used for the
    // trip-length poll, which is a custom poll but benefits from
    // letting respondents flag every duration they can swing.
    const defaultMultiSelect = entry.type === 'destination' || entry.type === 'dates';
    const { data: poll, error: pollErr } = await supabase
      .from('polls')
      .insert({
        trip_id: tripId,
        type: entry.type,
        title: entry.title,
        status: isDecided ? 'decided' : 'live',
        allow_multi_select: !isDecided && (entry.allow_multi_select ?? defaultMultiSelect),
        allow_write_ins: entry.allow_write_ins === true,
        position: position++,
      })
      .select()
      .single();
    if (pollErr) {
      console.warn('[trips] live poll insert failed:', pollErr.message);
      continue;
    }

    if (isFreeForm || entry.option_labels.length === 0) {
      // No preset options to insert. Two cases land here:
      //   • Legacy free-form numeric (duration poll w/ no chips, no
      //     write-ins) — respondents submit numeric_value responses.
      //   • Write-in polls with zero seed options (blank destination) —
      //     respondents add options via submit_poll_write_in.
      continue;
    }

    const { data: insertedOpts, error: optErr } = await supabase
      .from('poll_options')
      .insert(entry.option_labels.map((label, i) => ({
        poll_id: poll.id,
        label,
        position: i,
      })))
      .select();
    if (optErr) {
      console.warn('[trips] poll option insert failed:', optErr.message);
      continue;
    }

    // Decided polls need decided_option_id pointed at the (sole) option.
    if (isDecided && insertedOpts && insertedOpts[0]) {
      await supabase
        .from('polls')
        .update({ decided_option_id: insertedOpts[0].id })
        .eq('id', poll.id);
    }
  }
}

/**
 * Loose US-phone normalization. Accepts `(555) 123-4567`, `5551234567`,
 * `+15551234567`, `1-555-123-4567`. Returns E.164 (`+15551234567`) or
 * null on failure. Server-side normalizers (normalize_phone in
 * Postgres) are stricter; this is the planner-side first pass to keep
 * obviously-broken inputs out of the DB.
 */
function normalizeUSPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (raw.startsWith('+') && digits.length >= 10) return `+${digits}`;
  return null;
}

export async function getTrips(): Promise<Trip[]> {
  const { data, error } = await supabase
    .from('trips')
    .select('*')
    .eq('status', 'active')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function getTripsWithRespondentCounts(): Promise<TripWithRespondentCount[]> {
  // Supabase PostgREST returns embedded relations as { count: number } when only
  // the aggregate alias is selected.
  const { data, error } = await supabase
    .from('trips')
    .select('*, respondents(count), trip_members(count)')
    .eq('status', 'active')
    .order('created_at', { ascending: false });
  if (error) throw error;

  type CountShape = { count: number } | { count: number }[] | null;
  function extractCount(raw: CountShape): number {
    return Array.isArray(raw) ? (raw[0]?.count ?? 0) : (raw?.count ?? 0);
  }

  type TripRow = Trip & { respondents: CountShape; trip_members: CountShape };
  return (data ?? []).map((row: TripRow) => {
    const respondentCount = extractCount(row.respondents);
    const memberCount = extractCount(row.trip_members);
    const { respondents: _r, trip_members: _m, ...tripData } = row;
    return { ...tripData, respondentCount, memberCount } satisfies TripWithRespondentCount;
  });
}

export async function getTripById(id: string): Promise<Trip> {
  const { data, error } = await supabase
    .from('trips')
    .select('*')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data;
}

export async function getTripByShareToken(token: string): Promise<TripWithPolls> {
  // Use the session-free anon client so this always runs as the anon role.
  // The normal client persists a browser session in localStorage; if the user
  // is authenticated, the authenticated RLS policy applies and blocks them
  // from reading trips they didn't create/join.  The share link is the
  // application-layer access gate — any bearer of the token should see the trip.
  const { data, error } = await supabaseAnon
    .from('trips')
    .select(`
      *,
      polls (
        *,
        poll_options!poll_options_poll_id_fkey (*)
      )
    `)
    .eq('share_token', token)
    .eq('status', 'active')
    .single();
  if (error) throw error;
  // Filter to live polls only (done client-side so the trip is always returned
  // even when no polls are live yet — server-side .in() on a nested resource
  // acts as an inner join and would 404 the whole request)
  data.polls = (data.polls ?? [])
    .filter((p: { status: string }) => p.status === 'live')
    .sort((a: { position: number }, b: { position: number }) => a.position - b.position);
  data.polls.forEach((p: { poll_options: { position: number }[] }) => {
    p.poll_options.sort((a: { position: number }, b: { position: number }) => a.position - b.position);
  });
  return data;
}

export async function updateTrip(id: string, input: Partial<CreateTripInput>): Promise<Trip> {
  const { data, error } = await supabase
    .from('trips')
    .update(input)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  // If book-by changed, the cadence schedule needs to be reseeded with
  // the new responses_due. Poke the scheduler so the dashboard reflects
  // the new schedule before the next cron tick.
  if ('book_by_date' in input || 'responses_due_date' in input) {
    pokeNudgeScheduler();
  }
  return data;
}

export async function updateTripStatus(id: string, status: Trip['status']): Promise<void> {
  const { error } = await supabase.from('trips').update({ status }).eq('id', id);
  if (error) throw error;
}

export async function deleteTrip(id: string): Promise<void> {
  const { error } = await supabase.from('trips').delete().eq('id', id);
  if (error) throw error;
}

export function getShareUrl(shareToken: string): string {
  const base = process.env.EXPO_PUBLIC_APP_URL ?? 'https://rallyapp.io';
  return `${base}/respond/${shareToken}`;
}

/**
 * Public read-only trip status URL (Phase 8a). Anyone with the link sees
 * destination + dates + headcount + planner without needing the app or
 * filling out a form. Distinct from getShareUrl which routes to the
 * pollable survey form.
 */
export function getStatusUrl(shareToken: string): string {
  const base = process.env.EXPO_PUBLIC_APP_URL ?? 'https://rallyapp.io';
  return `${base}/status/${shareToken}`;
}
