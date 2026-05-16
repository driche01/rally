/**
 * IATA airport code → IANA timezone lookup.
 *
 * Per Phase C Q25: home_airport is required at profile capture; this
 * map resolves the recipient's local timezone for quiet-hours gating
 * (no SMS between 9pm–9am recipient local).
 *
 * Covers all US/CA/MX major airports plus the international hubs most
 * likely to appear for an alpha cohort traveling out of North America.
 * Add more rows as alpha + beta surface gaps. Missing-IATA fallback is
 * the sender's local timezone (see _sms-shared/dm-sender.ts).
 *
 * Sources: IANA TZ database (2024c), airport-tz spot checks. Snake-case
 * keys are uppercased IATA codes; values are IANA zone IDs.
 */

const IATA_TO_TZ: Readonly<Record<string, string>> = {
  // ─── US — Eastern ─────────────────────────────────────────────────
  ATL: "America/New_York",    // Atlanta
  BDL: "America/New_York",    // Hartford
  BNA: "America/Chicago",     // Nashville (Central!)
  BOS: "America/New_York",    // Boston
  BTV: "America/New_York",    // Burlington VT
  BUF: "America/New_York",    // Buffalo
  BWI: "America/New_York",    // Baltimore
  CHS: "America/New_York",    // Charleston SC
  CLE: "America/New_York",    // Cleveland
  CLT: "America/New_York",    // Charlotte
  CMH: "America/New_York",    // Columbus
  CVG: "America/New_York",    // Cincinnati
  DCA: "America/New_York",    // DC National
  DTW: "America/New_York",    // Detroit
  EWR: "America/New_York",    // Newark
  FLL: "America/New_York",    // Fort Lauderdale
  IAD: "America/New_York",    // DC Dulles
  IND: "America/New_York",    // Indianapolis (Eastern, no DST conflict since 2006)
  JAX: "America/New_York",    // Jacksonville
  JFK: "America/New_York",    // NYC JFK
  LGA: "America/New_York",    // NYC LaGuardia
  MCO: "America/New_York",    // Orlando
  MDT: "America/New_York",    // Harrisburg
  MIA: "America/New_York",    // Miami
  MYR: "America/New_York",    // Myrtle Beach
  ORF: "America/New_York",    // Norfolk
  PBI: "America/New_York",    // West Palm Beach
  PHL: "America/New_York",    // Philadelphia
  PIT: "America/New_York",    // Pittsburgh
  PVD: "America/New_York",    // Providence
  PWM: "America/New_York",    // Portland ME
  RDU: "America/New_York",    // Raleigh-Durham
  RIC: "America/New_York",    // Richmond
  ROC: "America/New_York",    // Rochester NY
  RSW: "America/New_York",    // Fort Myers
  SAV: "America/New_York",    // Savannah
  SDF: "America/New_York",    // Louisville
  SRQ: "America/New_York",    // Sarasota
  SYR: "America/New_York",    // Syracuse
  TPA: "America/New_York",    // Tampa
  TYS: "America/New_York",    // Knoxville

  // ─── US — Central ────────────────────────────────────────────────
  AUS: "America/Chicago",     // Austin
  BHM: "America/Chicago",     // Birmingham
  DAL: "America/Chicago",     // Dallas Love
  DFW: "America/Chicago",     // Dallas-Fort Worth
  DSM: "America/Chicago",     // Des Moines
  FSD: "America/Chicago",     // Sioux Falls
  HOU: "America/Chicago",     // Houston Hobby
  IAH: "America/Chicago",     // Houston Bush
  ICT: "America/Chicago",     // Wichita
  JAN: "America/Chicago",     // Jackson MS
  LIT: "America/Chicago",     // Little Rock
  MCI: "America/Chicago",     // Kansas City
  MDW: "America/Chicago",     // Chicago Midway
  MEM: "America/Chicago",     // Memphis
  MKE: "America/Chicago",     // Milwaukee
  MOB: "America/Chicago",     // Mobile
  MSP: "America/Chicago",     // Minneapolis-St Paul
  MSY: "America/Chicago",     // New Orleans
  OKC: "America/Chicago",     // Oklahoma City
  OMA: "America/Chicago",     // Omaha
  ORD: "America/Chicago",     // Chicago O'Hare
  PNS: "America/Chicago",     // Pensacola
  SAT: "America/Chicago",     // San Antonio
  SDF_CT: "America/Chicago",  // (intentionally absent — keep SDF Eastern)
  STL: "America/Chicago",     // St Louis
  TUL: "America/Chicago",     // Tulsa
  TYR: "America/Chicago",     // Tyler TX

  // ─── US — Mountain ───────────────────────────────────────────────
  ABQ: "America/Denver",      // Albuquerque
  BIL: "America/Denver",      // Billings
  BOI: "America/Boise",       // Boise
  BZN: "America/Denver",      // Bozeman
  COS: "America/Denver",      // Colorado Springs
  DEN: "America/Denver",      // Denver
  ELP: "America/Denver",      // El Paso (Mountain even though Texas — actual TZ)
  GJT: "America/Denver",      // Grand Junction
  IDA: "America/Boise",       // Idaho Falls
  JAC: "America/Denver",      // Jackson Hole
  MSO: "America/Denver",      // Missoula
  SAF: "America/Denver",      // Santa Fe
  SGU: "America/Denver",      // St George UT
  SLC: "America/Denver",      // Salt Lake City
  TUS: "America/Phoenix",     // Tucson (Mountain but no DST)

  // ─── US — Mountain (no DST) ──────────────────────────────────────
  FLG: "America/Phoenix",     // Flagstaff
  PHX: "America/Phoenix",     // Phoenix
  YUM: "America/Phoenix",     // Yuma

  // ─── US — Pacific ────────────────────────────────────────────────
  BFL: "America/Los_Angeles", // Bakersfield
  BOI_PT: "America/Boise",    // (intentionally absent — Boise is Mountain)
  BUR: "America/Los_Angeles", // Burbank
  EUG: "America/Los_Angeles", // Eugene
  FAT: "America/Los_Angeles", // Fresno
  GEG: "America/Los_Angeles", // Spokane
  LAS: "America/Los_Angeles", // Las Vegas
  LAX: "America/Los_Angeles", // LA
  LGB: "America/Los_Angeles", // Long Beach
  MFR: "America/Los_Angeles", // Medford
  OAK: "America/Los_Angeles", // Oakland
  ONT: "America/Los_Angeles", // Ontario CA
  PDX: "America/Los_Angeles", // Portland OR
  PSP: "America/Los_Angeles", // Palm Springs
  RDM: "America/Los_Angeles", // Bend/Redmond
  RNO: "America/Los_Angeles", // Reno
  SAN: "America/Los_Angeles", // San Diego
  SBA: "America/Los_Angeles", // Santa Barbara
  SBP: "America/Los_Angeles", // San Luis Obispo
  SEA: "America/Los_Angeles", // Seattle
  SFO: "America/Los_Angeles", // San Francisco
  SJC: "America/Los_Angeles", // San Jose
  SMF: "America/Los_Angeles", // Sacramento
  SMX: "America/Los_Angeles", // Santa Maria
  SNA: "America/Los_Angeles", // Orange County
  STS: "America/Los_Angeles", // Santa Rosa

  // ─── US — Alaska / Hawaii / Territories ──────────────────────────
  ANC: "America/Anchorage",   // Anchorage
  FAI: "America/Anchorage",   // Fairbanks
  HNL: "Pacific/Honolulu",    // Honolulu
  ITO: "Pacific/Honolulu",    // Hilo
  JNU: "America/Juneau",      // Juneau
  KOA: "Pacific/Honolulu",    // Kona
  LIH: "Pacific/Honolulu",    // Lihue Kauai
  OGG: "Pacific/Honolulu",    // Maui
  SJU: "America/Puerto_Rico", // San Juan

  // ─── Canada ──────────────────────────────────────────────────────
  YEG: "America/Edmonton",    // Edmonton
  YHZ: "America/Halifax",     // Halifax
  YOW: "America/Toronto",     // Ottawa
  YQB: "America/Toronto",     // Quebec City
  YUL: "America/Toronto",     // Montreal
  YVR: "America/Vancouver",   // Vancouver
  YWG: "America/Winnipeg",    // Winnipeg
  YXE: "America/Regina",      // Saskatoon
  YYC: "America/Edmonton",    // Calgary
  YYJ: "America/Vancouver",   // Victoria
  YYT: "America/St_Johns",    // St John's NL
  YYZ: "America/Toronto",     // Toronto

  // ─── Mexico ──────────────────────────────────────────────────────
  CUN: "America/Cancun",      // Cancun
  GDL: "America/Mexico_City", // Guadalajara
  MEX: "America/Mexico_City", // Mexico City
  MID: "America/Merida",      // Merida
  MTY: "America/Monterrey",   // Monterrey
  PVR: "America/Bahia_Banderas", // Puerto Vallarta
  SJD: "America/Mazatlan",    // Los Cabos
  ZIH: "America/Mexico_City", // Ixtapa
  ZLO: "America/Mexico_City", // Manzanillo

  // ─── Caribbean / Central America ─────────────────────────────────
  AUA: "America/Aruba",       // Aruba
  BGI: "America/Barbados",    // Barbados
  GCM: "America/Cayman",      // Grand Cayman
  HAV: "America/Havana",      // Havana
  KIN: "America/Jamaica",     // Kingston
  MBJ: "America/Jamaica",     // Montego Bay
  NAS: "America/Nassau",      // Nassau
  POS: "America/Port_of_Spain", // Trinidad
  PUJ: "America/Santo_Domingo", // Punta Cana
  SDQ: "America/Santo_Domingo", // Santo Domingo
  SXM: "America/Lower_Princes", // St Maarten
  GUA: "America/Guatemala",   // Guatemala City
  PTY: "America/Panama",      // Panama City
  SAL: "America/El_Salvador", // San Salvador
  SJO: "America/Costa_Rica",  // San Jose CR
  TGU: "America/Tegucigalpa", // Tegucigalpa

  // ─── South America ───────────────────────────────────────────────
  BOG: "America/Bogota",      // Bogota
  CCS: "America/Caracas",     // Caracas
  EZE: "America/Argentina/Buenos_Aires", // Buenos Aires
  GIG: "America/Sao_Paulo",   // Rio de Janeiro
  GRU: "America/Sao_Paulo",   // Sao Paulo
  LIM: "America/Lima",        // Lima
  MVD: "America/Montevideo",  // Montevideo
  SCL: "America/Santiago",    // Santiago
  UIO: "America/Guayaquil",   // Quito

  // ─── Western Europe ──────────────────────────────────────────────
  AMS: "Europe/Amsterdam",    // Amsterdam
  BCN: "Europe/Madrid",       // Barcelona
  BHX: "Europe/London",       // Birmingham UK
  BRU: "Europe/Brussels",     // Brussels
  CDG: "Europe/Paris",        // Paris CDG
  DUB: "Europe/Dublin",       // Dublin
  EDI: "Europe/London",       // Edinburgh
  FCO: "Europe/Rome",         // Rome
  FRA: "Europe/Berlin",       // Frankfurt
  GLA: "Europe/London",       // Glasgow
  HAM: "Europe/Berlin",       // Hamburg
  LHR: "Europe/London",       // London Heathrow
  LGW: "Europe/London",       // London Gatwick
  LIS: "Europe/Lisbon",       // Lisbon
  LYS: "Europe/Paris",        // Lyon
  MAD: "Europe/Madrid",       // Madrid
  MAN: "Europe/London",       // Manchester
  MRS: "Europe/Paris",        // Marseille
  MUC: "Europe/Berlin",       // Munich
  MXP: "Europe/Rome",         // Milan Malpensa
  NCE: "Europe/Paris",        // Nice
  OPO: "Europe/Lisbon",       // Porto
  ORY: "Europe/Paris",        // Paris Orly
  PMI: "Europe/Madrid",       // Palma
  STN: "Europe/London",       // London Stansted
  TXL: "Europe/Berlin",       // (closed but legacy) → Berlin
  VCE: "Europe/Rome",         // Venice
  VIE: "Europe/Vienna",       // Vienna
  ZRH: "Europe/Zurich",       // Zurich

  // ─── Eastern / Northern Europe ───────────────────────────────────
  ARN: "Europe/Stockholm",    // Stockholm
  ATH: "Europe/Athens",       // Athens
  BUD: "Europe/Budapest",     // Budapest
  CPH: "Europe/Copenhagen",   // Copenhagen
  HEL: "Europe/Helsinki",     // Helsinki
  IST: "Europe/Istanbul",     // Istanbul
  KEF: "Atlantic/Reykjavik",  // Reykjavik
  OSL: "Europe/Oslo",         // Oslo
  PRG: "Europe/Prague",       // Prague
  RIX: "Europe/Riga",         // Riga
  TLL: "Europe/Tallinn",      // Tallinn
  VNO: "Europe/Vilnius",      // Vilnius
  WAW: "Europe/Warsaw",       // Warsaw

  // ─── Middle East / Africa (selected hubs) ────────────────────────
  ADD: "Africa/Addis_Ababa",  // Addis Ababa
  AUH: "Asia/Dubai",          // Abu Dhabi
  CAI: "Africa/Cairo",        // Cairo
  CMN: "Africa/Casablanca",   // Casablanca
  CPT: "Africa/Johannesburg", // Cape Town
  DOH: "Asia/Qatar",          // Doha
  DXB: "Asia/Dubai",          // Dubai
  JNB: "Africa/Johannesburg", // Johannesburg
  KGL: "Africa/Kigali",       // Kigali
  NBO: "Africa/Nairobi",      // Nairobi
  TLV: "Asia/Jerusalem",      // Tel Aviv

  // ─── Asia / Pacific ──────────────────────────────────────────────
  AKL: "Pacific/Auckland",    // Auckland
  BKK: "Asia/Bangkok",        // Bangkok
  BOM: "Asia/Kolkata",        // Mumbai
  CGK: "Asia/Jakarta",        // Jakarta
  DEL: "Asia/Kolkata",        // Delhi
  DPS: "Asia/Makassar",       // Bali
  HAN: "Asia/Ho_Chi_Minh",    // Hanoi
  HKG: "Asia/Hong_Kong",      // Hong Kong
  HND: "Asia/Tokyo",          // Tokyo Haneda
  ICN: "Asia/Seoul",          // Seoul
  KIX: "Asia/Tokyo",          // Osaka
  KUL: "Asia/Kuala_Lumpur",   // Kuala Lumpur
  MEL: "Australia/Melbourne", // Melbourne
  MNL: "Asia/Manila",         // Manila
  NRT: "Asia/Tokyo",          // Tokyo Narita
  PEK: "Asia/Shanghai",       // Beijing
  PER: "Australia/Perth",     // Perth
  PVG: "Asia/Shanghai",       // Shanghai
  SGN: "Asia/Ho_Chi_Minh",    // Saigon
  SIN: "Asia/Singapore",      // Singapore
  SYD: "Australia/Sydney",    // Sydney
  TPE: "Asia/Taipei",         // Taipei
};

/**
 * Resolve an IATA code to an IANA timezone, or null if unknown.
 *
 * Inputs are case-insensitive. Returns null for unknown codes; callers
 * are expected to fall back to the sender's local tz (per Q25a).
 */
export function ianaForAirport(iata: string | null | undefined): string | null {
  if (!iata) return null;
  const key = iata.toUpperCase().trim();
  return IATA_TO_TZ[key] ?? null;
}

export { IATA_TO_TZ };
