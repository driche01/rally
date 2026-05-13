/**
 * Pre-filled deep-link URL builders for the lodging + flight search
 * sites Rally points planners + members to.
 *
 * Phase C+ enhancement (per user directive 2026-05-12): the "book
 * it" path stays as deep-link-out, but we now carry trip + profile
 * context into the destination's search form so the planner /
 * member lands one-step-closer to the booking flow. Real integrated
 * booking (in-app, affiliate-revenue) is parked for v2+.
 *
 * Each builder is best-effort — sites occasionally change their URL
 * shape; if our pre-fill breaks, the deep-link still opens the home
 * search page and the user can type the trip info manually. We
 * never block on perfect URL fidelity.
 *
 * All builders are pure / side-effect-free. Safe to call from
 * client or server.
 */

interface LodgingSearchParams {
  destination: string | null;
  start_date:  string | null;  // ISO date "YYYY-MM-DD"
  end_date:    string | null;
  adults?:     number;          // group size; defaults to 2
}

interface FlightSearchParams {
  origin:      string | null;  // IATA, e.g. "JFK"
  destination: string | null;  // city name or IATA
  start_date:  string | null;
  end_date:    string | null;
  passengers?: number;          // defaults to 1
}

// ─── Lodging search URLs ─────────────────────────────────────────

export function airbnbSearchUrl(p: LodgingSearchParams): string {
  // Airbnb's search URL shape:
  //   https://www.airbnb.com/s/<destination>/homes?checkin=...&checkout=...&adults=N
  const base = "https://www.airbnb.com";
  if (!p.destination) return `${base}/s/homes`;
  const slug = encodeURIComponent(p.destination.replace(/\s+/g, "-"));
  const qs   = new URLSearchParams();
  if (p.start_date) qs.set("checkin",  p.start_date);
  if (p.end_date)   qs.set("checkout", p.end_date);
  if (p.adults)     qs.set("adults", String(p.adults));
  const query = qs.toString();
  return `${base}/s/${slug}/homes${query ? `?${query}` : ""}`;
}

export function vrboSearchUrl(p: LodgingSearchParams): string {
  // VRBO:
  //   https://www.vrbo.com/search?destination=...&startDate=...&endDate=...&adults=N
  const base = "https://www.vrbo.com/search";
  const qs = new URLSearchParams();
  if (p.destination) qs.set("destination", p.destination);
  if (p.start_date)  qs.set("startDate",  p.start_date);
  if (p.end_date)    qs.set("endDate",    p.end_date);
  if (p.adults)      qs.set("adults", String(p.adults));
  const query = qs.toString();
  return `${base}${query ? `?${query}` : ""}`;
}

export function bookingComSearchUrl(p: LodgingSearchParams): string {
  // Booking.com:
  //   https://www.booking.com/searchresults.html?ss=<dest>&checkin=YYYY-MM-DD&checkout=YYYY-MM-DD&group_adults=N
  const base = "https://www.booking.com/searchresults.html";
  const qs = new URLSearchParams();
  if (p.destination) qs.set("ss", p.destination);
  if (p.start_date)  qs.set("checkin",  p.start_date);
  if (p.end_date)    qs.set("checkout", p.end_date);
  if (p.adults)      qs.set("group_adults", String(p.adults));
  const query = qs.toString();
  return `${base}${query ? `?${query}` : ""}`;
}

// ─── Flight search URL ───────────────────────────────────────────

export function googleFlightsUrl(p: FlightSearchParams): string {
  // Google Flights' best deep-link is the freeform `q` parameter,
  // which their search interprets. Example:
  //   ?q=Flights+from+JFK+to+Cancun+on+2026-12-12+through+2026-12-19
  const parts: string[] = ["Flights"];
  if (p.origin)      parts.push(`from ${p.origin}`);
  if (p.destination) parts.push(`to ${p.destination}`);
  if (p.start_date && p.end_date) {
    parts.push(`on ${p.start_date} through ${p.end_date}`);
  } else if (p.start_date) {
    parts.push(`on ${p.start_date}`);
  }
  const q = parts.join(" ");
  return `https://www.google.com/travel/flights?q=${encodeURIComponent(q)}`;
}

// ─── Convenience: build all from a Trip + (optional) profile ─────

/**
 * Returns the four standard search URLs for a trip's destination +
 * dates + group size. Used by the lodging tab's "Search more"
 * buttons.
 */
export function lodgingSearchSet(trip: {
  destination:        string | null;
  start_date:         string | null;
  end_date:           string | null;
  group_size_precise: number | null;
  group_size_bucket?: string | null;
}): { airbnb: string; vrbo: string; bookingCom: string } {
  const adults = trip.group_size_precise ?? bucketToCount(trip.group_size_bucket);
  const p: LodgingSearchParams = {
    destination: trip.destination,
    start_date:  trip.start_date,
    end_date:    trip.end_date,
    adults,
  };
  return {
    airbnb:     airbnbSearchUrl(p),
    vrbo:       vrboSearchUrl(p),
    bookingCom: bookingComSearchUrl(p),
  };
}

/**
 * Convenience for the Travel tab's per-member flight-search button.
 * Combines the member's home_airport (origin) with the trip's
 * destination + dates.
 */
export function flightSearchFor(
  homeAirport: string | null,
  trip: { destination: string | null; start_date: string | null; end_date: string | null },
): string {
  return googleFlightsUrl({
    origin:      homeAirport,
    destination: trip.destination,
    start_date:  trip.start_date,
    end_date:    trip.end_date,
  });
}

function bucketToCount(bucket: string | null | undefined): number {
  // Centerpoint of each Phase A bucket. Used as adults pre-fill when
  // group_size_precise isn't set.
  switch (bucket) {
    case "0-4":  return 3;
    case "5-8":  return 6;
    case "9-12": return 10;
    case "13-20": return 16;
    case "20+":  return 20;
    default:     return 2;
  }
}
