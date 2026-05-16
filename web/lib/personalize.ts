/**
 * Personalize an SMS body with per-recipient placeholders.
 *
 * Mirrors the edge-function helper at
 * `supabase/functions/_sms-shared/personalize.ts` so a planner's
 * custom note renders identically across edge-side (nudges, surveys)
 * and web-side (blasts, invitations) sends.
 *
 * Supported tokens (case-insensitive):
 *   [Name]        → recipient's first name
 *   [Their name]  → recipient's first name  (legacy alias)
 *   [Planner]     → planner's first name
 *   [Destination] → trip destination
 *   [Trip]        → trip name (falls back to destination, then "the trip")
 *   [BookBy]      → trip's book-by date as "Mon DD"
 *   [Survey link] → trip invite URL  (alias for the legacy TKTK literal)
 *
 * Each token falls back gracefully when the value isn't on file so
 * messages never go out with a literal "[Name]".
 */

const RECIPIENT_PLACEHOLDER     = /\[(?:Name|Their name)\]/gi;
const PLANNER_PLACEHOLDER       = /\[Planner\]/gi;
const DESTINATION_PLACEHOLDER   = /\[Destination\]/gi;
const TRIP_PLACEHOLDER          = /\[Trip\]/gi;
const BOOKBY_PLACEHOLDER        = /\[BookBy\]/gi;
const SURVEY_BRACKET_PLACEHOLDER = /\[Survey link\]/gi;
const SURVEY_LITERAL            = /\bTKTK\b/g;

function firstName(name: string | null | undefined): string | null {
  if (!name) return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  return trimmed.split(/\s+/)[0] ?? null;
}

function formatShortDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  // Take the first 10 chars to avoid TZ shifts on date-only inputs.
  const parts = iso.slice(0, 10).split("-");
  if (parts.length !== 3) return null;
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  if (m < 1 || m > 12) return null;
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${months[m - 1]} ${d}`;
}

export interface PersonalizeContext {
  recipientName?: string | null;
  plannerName?:   string | null;
  destination?:   string | null;
  tripName?:      string | null;
  bookByDate?:    string | null;  // ISO date 'YYYY-MM-DD'
  surveyUrl?:     string | null;
}

/** Token names that the legend UI exposes to planners. */
export const PERSONALIZE_TOKENS: { token: string; description: string }[] = [
  { token: "[Name]",        description: "Recipient's first name" },
  { token: "[Planner]",     description: "Your first name" },
  { token: "[Trip]",        description: "Trip name" },
  { token: "[Destination]", description: "Trip destination" },
  { token: "[BookBy]",      description: "Booking deadline (e.g. May 4)" },
];

export function personalizeBody(body: string, ctx: PersonalizeContext): string {
  if (!body) return body;

  const recipient   = firstName(ctx.recipientName)   ?? "there";
  const planner     = firstName(ctx.plannerName)     ?? "your planner";
  const destination = (ctx.destination ?? "").trim() || "the destination";
  const trip        = (ctx.tripName ?? "").trim()
                     || (ctx.destination ?? "").trim()
                     || "the trip";
  const bookBy      = formatShortDate(ctx.bookByDate) ?? "soon";
  const survey      = (ctx.surveyUrl ?? "").trim();

  let out = body
    .replace(RECIPIENT_PLACEHOLDER,   recipient)
    .replace(PLANNER_PLACEHOLDER,     planner)
    .replace(DESTINATION_PLACEHOLDER, destination)
    .replace(TRIP_PLACEHOLDER,        trip)
    .replace(BOOKBY_PLACEHOLDER,      bookBy);

  // Only swap survey tokens when we actually have a URL — otherwise
  // leave the literal so a misconfigured caller is obvious.
  if (survey) {
    out = out
      .replace(SURVEY_LITERAL,             survey)
      .replace(SURVEY_BRACKET_PLACEHOLDER, survey);
  }
  return out;
}
