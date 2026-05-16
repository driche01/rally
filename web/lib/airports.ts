/**
 * Airport typeahead dataset. Mirrors the prototype's airports.js.
 * Production will hit a real IATA dataset; for Phase A alpha this
 * 50-entry list covers the common US hubs + a few internationals.
 */

export interface Airport {
  code: string;
  name: string;
  city: string;
}

export const AIRPORTS: readonly Airport[] = [
  { code: "JFK", name: "John F. Kennedy",       city: "New York, NY" },
  { code: "LGA", name: "LaGuardia",             city: "New York, NY" },
  { code: "EWR", name: "Newark Liberty",        city: "Newark, NJ" },
  { code: "LAX", name: "Los Angeles Intl",      city: "Los Angeles, CA" },
  { code: "SFO", name: "San Francisco Intl",    city: "San Francisco, CA" },
  { code: "SJC", name: "San Jose Intl",         city: "San Jose, CA" },
  { code: "OAK", name: "Oakland Intl",          city: "Oakland, CA" },
  { code: "SAN", name: "San Diego Intl",        city: "San Diego, CA" },
  { code: "SEA", name: "Seattle-Tacoma",        city: "Seattle, WA" },
  { code: "PDX", name: "Portland Intl",         city: "Portland, OR" },
  { code: "DEN", name: "Denver Intl",           city: "Denver, CO" },
  { code: "ORD", name: "O'Hare Intl",           city: "Chicago, IL" },
  { code: "MDW", name: "Midway Intl",           city: "Chicago, IL" },
  { code: "DTW", name: "Detroit Metro",         city: "Detroit, MI" },
  { code: "MSP", name: "Minneapolis-St. Paul",  city: "Minneapolis, MN" },
  { code: "BOS", name: "Logan Intl",            city: "Boston, MA" },
  { code: "DCA", name: "Reagan National",       city: "Washington, DC" },
  { code: "IAD", name: "Dulles Intl",           city: "Washington, DC" },
  { code: "BWI", name: "Baltimore-Washington",  city: "Baltimore, MD" },
  { code: "PHL", name: "Philadelphia Intl",     city: "Philadelphia, PA" },
  { code: "CLT", name: "Charlotte Douglas",     city: "Charlotte, NC" },
  { code: "ATL", name: "Hartsfield-Jackson",    city: "Atlanta, GA" },
  { code: "MIA", name: "Miami Intl",            city: "Miami, FL" },
  { code: "FLL", name: "Fort Lauderdale-Hwd",   city: "Fort Lauderdale, FL" },
  { code: "MCO", name: "Orlando Intl",          city: "Orlando, FL" },
  { code: "TPA", name: "Tampa Intl",            city: "Tampa, FL" },
  { code: "IAH", name: "George Bush Intl",      city: "Houston, TX" },
  { code: "HOU", name: "William P. Hobby",      city: "Houston, TX" },
  { code: "DFW", name: "Dallas/Fort Worth",     city: "Dallas, TX" },
  { code: "DAL", name: "Dallas Love Field",     city: "Dallas, TX" },
  { code: "AUS", name: "Austin-Bergstrom",      city: "Austin, TX" },
  { code: "SAT", name: "San Antonio Intl",      city: "San Antonio, TX" },
  { code: "PHX", name: "Sky Harbor",            city: "Phoenix, AZ" },
  { code: "LAS", name: "Harry Reid Intl",       city: "Las Vegas, NV" },
  { code: "SLC", name: "Salt Lake City Intl",   city: "Salt Lake City, UT" },
  { code: "BNA", name: "Nashville Intl",        city: "Nashville, TN" },
  { code: "MEM", name: "Memphis Intl",          city: "Memphis, TN" },
  { code: "STL", name: "Lambert-St. Louis",     city: "St. Louis, MO" },
  { code: "MCI", name: "Kansas City Intl",      city: "Kansas City, MO" },
  { code: "IND", name: "Indianapolis Intl",     city: "Indianapolis, IN" },
  { code: "CMH", name: "John Glenn Columbus",   city: "Columbus, OH" },
  { code: "CLE", name: "Cleveland Hopkins",     city: "Cleveland, OH" },
  { code: "CVG", name: "Cincinnati/N. Kentucky",city: "Cincinnati, OH" },
  { code: "PIT", name: "Pittsburgh Intl",       city: "Pittsburgh, PA" },
  { code: "BUF", name: "Buffalo Niagara",       city: "Buffalo, NY" },
  { code: "ANC", name: "Ted Stevens Anchorage", city: "Anchorage, AK" },
  { code: "HNL", name: "Daniel K. Inouye",      city: "Honolulu, HI" },
  { code: "YYZ", name: "Toronto Pearson",       city: "Toronto, ON" },
  { code: "YVR", name: "Vancouver Intl",        city: "Vancouver, BC" },
  { code: "LHR", name: "Heathrow",              city: "London, UK" },
  { code: "CDG", name: "Charles de Gaulle",     city: "Paris, FR" },
  { code: "MEX", name: "Mexico City Intl",      city: "Mexico City, MX" },
  { code: "CUN", name: "Cancun Intl",           city: "Cancun, MX" },
];

export function searchAirports(query: string, limit = 6): Airport[] {
  const q = query.trim().toUpperCase();
  if (!q) return [];
  const out: Airport[] = [];
  for (const a of AIRPORTS) {
    if (
      a.code.startsWith(q) ||
      a.city.toUpperCase().includes(q) ||
      a.name.toUpperCase().includes(q)
    ) {
      out.push(a);
      if (out.length >= limit) break;
    }
  }
  return out;
}
