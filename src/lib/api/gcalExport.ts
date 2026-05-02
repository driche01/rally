/**
 * Google Calendar export.
 *
 * Bulk-creates Google Calendar events from a Rally trip's itinerary
 * blocks. Each block becomes one event on the planner's primary
 * calendar, with the trip's invited members (those whose email we have)
 * added as attendees — Google then sends invite emails on our behalf.
 *
 * Auth: uses the Google access token Supabase puts on session
 * .provider_token after a Google OAuth sign-in. The token is short-
 * lived (~1h) and isn't persisted across app restarts; callers should
 * trigger a re-auth via useGoogleSignIn when it's missing or 401s.
 *
 * Idempotency: each block is exported with a deterministic iCalUID
 * (`rally-block-{block.id}@rallysurveys.netlify.app`). Re-running the
 * export updates the existing Google event in place rather than
 * creating duplicates — Google honors iCalUID for de-dup on insert.
 */
import type { ItineraryBlock } from '@/types/database';

const GOOGLE_API_BASE = 'https://www.googleapis.com/calendar/v3';

export interface GcalExportInput {
  accessToken: string;
  blocks: ItineraryBlock[];
  /** Emails to attach as attendees on every event. Caller should
   *  pre-filter to unique, valid addresses. Empty list = no invites. */
  attendeeEmails: string[];
  /** IANA timezone for blocks without an explicit zone. Defaults to the
   *  device timezone when called from the client. */
  timeZone: string;
  /** Used in the event description to make the source obvious. */
  tripName: string | null;
  /** Used to build a survey link footer in the description. */
  tripShareUrl: string | null;
}

export interface GcalExportResult {
  /** Number of blocks successfully written to Google Calendar. */
  created: number;
  /** Blocks that failed, with the upstream error message for surfacing. */
  failed: Array<{ blockId: string; title: string; reason: string }>;
  /** Distinct attendee emails actually attached. */
  invited: string[];
  /** Set when the access token was rejected — caller should re-auth. */
  authExpired: boolean;
}

interface GcalEventBody {
  summary: string;
  description?: string;
  location?: string;
  start: { dateTime?: string; date?: string; timeZone?: string };
  end:   { dateTime?: string; date?: string; timeZone?: string };
  attendees?: Array<{ email: string }>;
  iCalUID?: string;
}

/** Build a calendar event body for a single block. Returns null when the
 *  block has no day_date — without one we have nothing to anchor on. */
function blockToEvent(
  block: ItineraryBlock,
  attendeeEmails: string[],
  timeZone: string,
  tripName: string | null,
  tripShareUrl: string | null,
): GcalEventBody | null {
  if (!block.day_date) return null;

  const day = block.day_date; // 'YYYY-MM-DD'

  // Default to a 1-hour slot at 9am local when the block has no times,
  // and pad missing end_time to start_time + 1h. Google rejects events
  // where end <= start so we always normalize.
  const start = block.start_time ?? '09:00';
  const end = block.end_time ?? addHour(start);

  const startDateTime = `${day}T${normalizeHHMM(start)}:00`;
  const endDateTime   = `${day}T${normalizeHHMM(end)}:00`;

  const descriptionLines: string[] = [];
  if (block.notes) descriptionLines.push(block.notes);
  if (tripName) descriptionLines.push(`Trip: ${tripName}`);
  if (tripShareUrl) descriptionLines.push(`Survey: ${tripShareUrl}`);
  descriptionLines.push('Synced from Rally');

  const body: GcalEventBody = {
    summary: block.title || 'Untitled',
    description: descriptionLines.join('\n'),
    start: { dateTime: startDateTime, timeZone },
    end:   { dateTime: endDateTime,   timeZone },
    iCalUID: `rally-block-${block.id}@rallysurveys.netlify.app`,
  };
  if (block.location) body.location = block.location;
  if (attendeeEmails.length > 0) {
    body.attendees = attendeeEmails.map((email) => ({ email }));
  }
  return body;
}

function normalizeHHMM(t: string): string {
  // Accept 'H:MM', 'HH:MM', or 'HH:MM:SS' — return 'HH:MM'.
  const [h, m] = t.split(':');
  const hh = String(Math.max(0, Math.min(23, parseInt(h, 10) || 0))).padStart(2, '0');
  const mm = String(Math.max(0, Math.min(59, parseInt(m ?? '0', 10) || 0))).padStart(2, '0');
  return `${hh}:${mm}`;
}

function addHour(t: string): string {
  const [h, m] = t.split(':');
  const hh = (parseInt(h, 10) + 1) % 24;
  return `${String(hh).padStart(2, '0')}:${m ?? '00'}`;
}

/** Insert one event. `sendUpdates=all` triggers Google's invite emails
 *  to attendees as soon as the event is created. */
async function insertEvent(
  accessToken: string,
  body: GcalEventBody,
): Promise<{ ok: true } | { ok: false; status: number; reason: string }> {
  const res = await fetch(
    `${GOOGLE_API_BASE}/calendars/primary/events?sendUpdates=all`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
  );
  if (res.ok) return { ok: true };
  let reason = `HTTP ${res.status}`;
  try {
    const data = await res.json();
    reason = data?.error?.message ?? reason;
  } catch {
    // ignore parse failures — leave the HTTP status as the reason.
  }
  return { ok: false, status: res.status, reason };
}

/** Run the export. Stops early on 401/403 since every subsequent call
 *  would fail the same way; the caller re-auths and retries. */
export async function exportItineraryToGoogleCalendar(
  input: GcalExportInput,
): Promise<GcalExportResult> {
  const { accessToken, blocks, attendeeEmails, timeZone, tripName, tripShareUrl } = input;

  const result: GcalExportResult = {
    created: 0,
    failed: [],
    invited: attendeeEmails,
    authExpired: false,
  };

  for (const block of blocks) {
    const body = blockToEvent(block, attendeeEmails, timeZone, tripName, tripShareUrl);
    if (!body) {
      result.failed.push({
        blockId: block.id,
        title: block.title || 'Untitled',
        reason: 'Block has no date',
      });
      continue;
    }
    const r = await insertEvent(accessToken, body);
    if (r.ok) {
      result.created += 1;
      continue;
    }
    if (r.status === 401 || r.status === 403) {
      result.authExpired = true;
      result.failed.push({
        blockId: block.id,
        title: body.summary,
        reason: 'Google sign-in expired',
      });
      break;
    }
    result.failed.push({
      blockId: block.id,
      title: body.summary,
      reason: r.reason,
    });
  }

  return result;
}
