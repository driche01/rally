# Rally — v1 Scope

*Partiful for trips, with the dashboard your group chat keeps trying to be.*

---

## TL;DR

Rally is the operating system for group trips with friends. The wedge is closing the commitment gap between "we should do this" and "everyone's actually in." The shape is **invitation-first** (Partiful is the model for the front door), with a **dashboard** that replaces the Google Sheet your friends keep half-filling out, and an **SMS agent** that holds the trip together between sessions.

v1 ships on **web + SMS only**. Mobile comes later, with shared identity and data.

---

## Decisions locked so far

- **Wedge:** closing the commitment gap. Trips die between "we should do this" and "everyone's actually in." That's the bar everything else serves.
- **Surfaces:** invitation page (Partiful-style), travel profile (Tinder-style capture), dashboard (Google Sheet replacement, AI-generated drafts), 1:1 SMS agent, deep-link booking. Mobile parked.
- **SMS agent:** 1:1, outbound-only in v1. Never in the group iMessage thread. Replies happen on web via links. Two-way SMS parked until monetization for cost reasons.
- **Broadcast model:** dual-channel. Web activity feed for ambient updates (anyone posts, low-stakes). Planner-triggered SMS blasts for high-stakes pushes (rate-limited, cohost-accessible, auto-posts to feed).
- **Blast rate limits:** 3 per week per trip, 10 per trip lifecycle (starting point — adjustable based on alpha behavior).
- **Private blast replies:** deferred. If an invitee wants to reply privately to the planner, they text the planner directly themselves. No private channel built in v1.
- **Mobile parity model:** every feature on both surfaces, UX reimagined per form factor (not a webview port).
- **Booking in v1:** deep-link out only. Confirmations entered on web. Affiliate revenue v2+.
- **Cost splitting:** lodging cost split is in v1 (it's 70% of the work anyway). Native general cost splitting parked for v2.
- **Generate Flyer:** in v1, Phase B. Templated MVP version (destination photo + overlay) — punching above its weight as a growth lever.
- **Clone Trip:** in v1, Phase B, **cheap-or-cut** — if it gets expensive during build, drop without re-litigation.
- **Travel profile is required at first RSVP, ever.** Filled out once per user lifetime. Edited any time. On subsequent trips, surfaced inline at RSVP for one-tap confirmation. Load-bearing commitment: profile capture must be **sub-30-second, tap-driven, visually fun** — Tinder-style swipe/tap vibes, no typing where avoidable. If we can't ship it that way, the model breaks.
- **Profile is the engine, not a tab.** Aggregated profile data drives the AI-generated drafts for Itinerary, Lodging, Travel, and Meals. Profile Insights surfaces alignment/misalignment to the planner, but isn't a separate workstream tab — every other Phase B feature consumes profile data as input.
- **Mutuals:** minimal-then-upgrade. Phase A ships the simple checklist; Phase B upgrades to filters, search, sort once there's trip history that makes sorting meaningful.
- **The hero FUN moments:** voting on AI-generated items (itinerary, meals, lodging options) AND the profile capture flow itself. Where social delight + first-impression delight happen.
- **Design strategy:** hide the form inside the vibes. Same data as a Google Sheet, feels like a planning room. Profile is not a form, it's a vibe quiz.

---

## The product, in one breath

A planner kicks off a trip with destination, dates, and budget already locked in. Friends get an invite that feels like a flyer for a party, not a Google Form. They tap RSVP, do a 25-second Tinder-style travel profile (one time, ever — it follows them across every future trip), and the planner gets a live dashboard that auto-builds itself from the aggregated group profile: AI-drafted itinerary, lodging suggestions, meal ideas, all seeded by what the group actually wants. People vote, edit, commit. An SMS agent sends well-timed 1:1 nudges with links back to web for whatever's needed next — RSVP, vote, enter your flight. The planner never has to chase. The trip stays alive.

---

## The surfaces

### 1. The invitation — Partiful for trips
The front door. Where invitees land. Where commitment happens.

**The invitation page (what invitees see):**
- Themed templates (a la Partiful's Classic / Eclectic / Fancy / Literary / Digital / Elegant)
- Trip details: destination, dates, budget range, optional cover photo or illustration
- Emoji RSVPs: Going / Maybe / Can't Go
- Hosted by + cohosts
- Description, location, cost-per-person estimate, custom sections (links, playlists, things to bring)
- Guest list with avatars + count
- Photo album
- Activity feed: RSVP updates, comments, GIFs — the social texture
- "Make it public" toggle for trips open to a wider circle

**Sending invites (the host flow):**
- Compose a custom message ("Hey [Name], [Host] invited you to [Trip Name]: [optional custom note] — RSVP at [link]") with a character limit
- Pick recipients from: search, **past trip-mates** (mutuals integration — the social graph paying off here at the highest-leverage moment), or filter by past trip
- Multi-channel send: copy link, add from phone contacts, email invite, or generate a shareable flyer
- Real-time invitee list as recipients are selected
- Already-invited guests show "Invited" status to prevent dupes

**Generate Flyer is a growth lever, not just a feature.** A designed shareable graphic — destination photo, dates, hosts, tap-to-RSVP link/QR — built for Instagram stories and group DMs. Every share is a marketing surface. For a destination product, the flyer is more potent than it is for a generic party because the imagery itself is aspirational. Worth fighting to keep in v1 even at MVP quality.

### 2. The travel profile — the engine, not a tab
The thing Partiful doesn't have, and our actual differentiator. The profile is **required at first RSVP**, but **only ever filled out once per user**. Returning users confirm in one tap. The aggregated profile data is the input that powers every AI-generated feature in Phase B.

**The capture experience (load-bearing — this must be FAST and FUN):**
- Sub-30-seconds end to end. Target: 25.
- Tinder-style swipe/tap cards. No dropdowns. No free-text where avoidable.
- Visual, vibe-driven prompts: "Beach or mountains?", "Spa or hike?", "Foodie or fast-casual?", "Social or chill?", "Culture or relaxation?"
- Home airport: typeahead, ~5 seconds
- Dietary restrictions: multi-select chips, optional, skippable
- Budget comfort: tappable tier picker

Feels like the start of the trip, not a form. This is one of the FUN moments to overinvest in design-wise — alongside voting. If we can't ship the profile capture at this quality bar, the required-at-RSVP model breaks and we have to fall back to "prompted, not required" (the funnel-protective option).

**Profile lifecycle:**
- **First RSVP ever:** profile capture is required before RSVP completes. The flow is part of the RSVP, not a follow-up.
- **Subsequent RSVPs:** existing profile surfaced inline — "Here's your travel profile — looks right? [Yes, RSVP] / [Edit first]". Optional edit, one-tap confirm. Reminds the user their data is being used (transparency) without re-prompting capture.
- **Edit any time:** profile is accessible from the user's account, editable per-trip if someone wants to override defaults for a specific trip (e.g., usually I'm chill but this is a bachelor party).

**Profile is the engine — what it powers in Phase B:**
- **Itinerary AI generation** — aggregated vibe preferences drive activity suggestions ("group skews chill/food/culture → suggest food tours, museum half-days, sunset cocktail spots, not bar crawls")
- **Lodging suggestions** — budget comfort + social vs. chill + group size drive Airbnb vs. hotel vs. cabin recommendations
- **Travel suggestions** — home airports drive flight options + group arrival timing
- **Meal recommendations** — dietary restrictions surface into meal planning; vibe preferences inform restaurant style
- **Planner alignment view** — surfaces alignment/misalignment ("5 of 8 want chill, 2 want adventurous — here's where to compromise"). Not a separate tab — folded into the relevant feature surfaces.

**Empty-profile handling:** every AI-generated draft must handle the case where some profiles are incomplete (someone hasn't RSVP'd yet, or skipped optional fields). Drafts degrade gracefully — fewer profiles = more generic suggestions, but never broken. The Profile Prompt SMS auto-reminder closes the gap over time.

### 3. The dashboard — your Google Sheet, but it builds itself
The planner's command center. Every Phase B feature is **AI-drafted from aggregated profile data, then editable + voteable**. The dashboard isn't a blank spreadsheet — it pre-populates with intelligent defaults the group can react to. From the ski trip sheet, mapped to native surfaces:

- **Roster** *(absorbs Partiful's "Manage Guests")* — who's in, RSVP status, contact info, travel profile snapshot. Filterable by status (Going / Maybe / Invited / Can't Go), searchable, sortable. Host can override RSVP on someone's behalf for the "Sean said yes in person but hasn't tapped yet" case. Visible to hosts only. **Alignment insights** ("5 of 8 want chill, 2 want adventurous") surface here as a planner-facing summary, and contextually inside each AI-drafted tab below.
- **Lodging** *(replaces Rooms / Cost)* — **AI-suggested options based on aggregated profile** (budget comfort + vibe + group size → Airbnb vs. hotel vs. cabin recommendations). Planner picks, then room layouts, room assignments, per-person cost, payment status, link out to Splitwise (native split parked for v2)
- **Travel** *(replaces Driving)* — **AI-coordinated based on home airports from profiles**: suggested flights per person, group arrival timing, car groupings with departure times. Captures: flight info, return travel, airport pickups
- **Itinerary** *(replaces Mountain Sched)* — **AI-drafted from aggregated vibe preferences**: day-by-day plan seeded by the group's actual interests. Voting on items, edits, alternatives.
- **Meals** *(replaces Food)* — **AI-suggested meal plan** seeded by dietary restrictions + vibe (cook-in vs. restaurant-heavy based on social/chill signals). Assigned cooks/volunteers, voting on restaurants.
- **Shopping List** *(replaces Consolidated Groceries)* — auto-deduplicated from the meal plan, with "who's bringing what" assignments. **This is the wow feature.** Manual in your sheet, automatic here.

### 4. The SMS agent (1:1 and outbound-only in v1)
The rail that holds the trip together between web sessions. **1:1, never in the group iMessage thread.** **Outbound-only in v1** — invitees don't text the agent back; every SMS contains a link to the relevant web surface where replies, votes, bookings, and data entry actually happen. This mirrors Partiful's Text Blast pattern.

Why outbound-only: per-message Twilio fees would balloon if invitees could text the agent freely before we have revenue to cover it. Two-way conversational SMS is parked until monetization. This is a deliberate cost-driven simplification that *also* dramatically reduces v1 build complexity — no NLU, no inbound parsing, no edge-case-heavy free-text interpretation.

**Two flavors of outbound SMS:**

**Auto Reminders** — system-generated, scheduled, fire based on RSVP status and trip timeline. Pattern mirrors Partiful's:
- *RSVP nudge* — to Invited & Maybe at intervals before the trip
- *Profile completion nudge* — to Going members who skipped optional profile fields (dietary, budget) on first capture. Less critical than v1's earlier design since profile is required at first RSVP, but covers the edge cases where data is thin.
- *Booking nudge* — to Going members without confirmed flight or lodging details
- *Pre-trip summary* — to Going members 2–3 days out
- Each one ends with a CTA link to the relevant web surface

**Planner Blasts** — host- or cohost-triggered one-offs, composed from the dashboard:
- "Final call on the Airbnb — voting closes tonight 👀"
- "We just locked the cabin 🎉 details inside"
- Composer with preview before send, recipient-segment selector (Going / Maybe / Invited / All)
- Rate-limited: **3 per week per trip, 10 per trip lifecycle** (starting point, adjustable based on alpha behavior). Carriers care about volume patterns, so we set this expectation upfront rather than retroactively clamping.
- **Auto-posts to the activity feed** so the web stays in sync with what hit phones
- Private replies to blasts are deferred — invitees who want to reply privately just text the planner directly themselves. No private channel built in v1.

**Voice principles:**
- Personal, 1:1 — every message sent individually with the recipient's name
- Link-driven — every SMS ends with a CTA
- Playful, not formal — "👀 Bri, your friends are bailing without you" not "Hi Bri, please RSVP"
- Restrained — fewer well-timed messages beat constant pings

**What does NOT happen via SMS in v1** (all moved to web, linked from SMS):
- Travel detail capture (web form)
- Booking confirmation entry (web form)
- Voting on itinerary / meals (web with live tally)
- Profile capture (web flow)
- Free-form replies to the agent (parked until monetization unlocks two-way)

**Cohost permissions:** cohosts get full blast composition + auto-reminder configuration access, same as host.

### 5. Booking (v1: deep-link out)
Functional, not yet integrated.

- Pre-filled Airbnb / VRBO / Booking deep links with destination + dates + group size
- Pre-filled Google Flights links per person (their home airport → destination)
- After someone books, they enter confirmation details on the web (linked from SMS booking nudges) — populates the Travel and Lodging sections
- v2+: integrated booking with affiliate / commission revenue

### 6. The social layer (light v1, deeper later)
- Persistent user profiles
- Travel profile per user
- Mutuals — friends you've traveled with, like Partiful's mutuals page. Surfaces directly in the invite flow ("invite from past trip-mates") so the social graph earns its keep at the funnel entry, not just in a standalone profile page.
- Trip history per user
- Parked for later: world map of places visited, badges, leaderboards

### 7. Host controls (the planner's behind-the-scenes)
The planner's admin layer for managing the trip. Surfaces Partiful covers in their "More" menu, plus the trip-specific stuff Rally needs.

- **Event Settings** — name, dates, destination, capacity, cohosts, theme, public/private
- **Generate Flyer** — see Section 1; accessible from the More menu as a standalone action
- **Clone Trip** — duplicate the trip structure for recurring trips (annual ski trip, Friendsgiving, group bachelor weekends). High-retention play. **In v1 Phase B, cheap-or-cut.** Ships if the trip data model stays clean and Clone is a few days of work. Drops without re-litigation if it bloats during build.
- **Cancel Trip** — explicitly destructive, requires confirmation, notifies all guests via blast + auto-posts to activity feed. Closes the loop cleanly.
- **FAQ link** — help docs

Cohosts get full access to all of these, same as host.

---

## v1 phasing — three shippable cuts

### Phase A — Invitation + roster
*Goal: prove the commitment wedge works.*

### Phase A — Invitation + profile + roster
*Goal: prove the commitment wedge works.*

- Trip creation
- Invitation page (themed, RSVPs, guest list, activity feed)
- **Travel profile capture — Tinder-style, sub-30-second, required at first RSVP**
- **Returning-user profile confirmation flow** (one-tap confirm at subsequent RSVPs)
- Dashboard v0: Roster only
- Mutuals (minimal — checkbox list in invite flow)

If commitment doesn't improve here, nothing later matters. Ship to alpha, watch what happens.

### Phase B — The dashboard (AI-drafted from profile data)
*Goal: become the Google Sheet replacement, with intelligent defaults instead of blank tabs.*

**Phase B prerequisite (ships first):** the **profile aggregation engine** — the service that ingests group profiles and produces structured input for AI generation across all downstream tabs. Empty-profile graceful degradation built in from day one.

**Build order (locked, Path A: wow-first):**
1. **Generate Flyer** (templated MVP — destination photo, overlay with trip name/dates/hosts, QR/RSVP link, export image). Cheapest, most viral, ships first.
2. **Itinerary tab** + AI generation from profile data + voting on items. The hero FUN moment.
3. **Lodging tab** + AI-suggested options + room assignments + cost split-out (link to Splitwise). Forces real commitment by surfacing money decisions.
4. **Travel tab** + AI-coordinated arrival timing + car groupings + flight capture.
5. **Meals tab** + AI-suggested meal plan + dietary surfacing + voting on restaurants.
6. **Shopping List** — auto-deduplicated from the meal plan, with assignments. The magic feature, depends on Meals shipping first.
7. **Clone Trip** — cheap-or-cut. If the trip data model stays clean through Phase B, Clone is a few days of work and slips in. If it's bloating, drop without re-litigation.
- Booking deep links live across Lodging + Travel tabs (not a standalone item)
- Manage Guests / Roster filters + host RSVP overrides land alongside the relevant tab work

### Phase C — Full SMS coverage + re-engagement
*Goal: every key moment in the trip lifecycle has a corresponding SMS nudge that pulls people back to web at the right time.*

- All Auto Reminder types implemented (RSVP, profile, booking, pre-trip)
- Manual Blast composer in the dashboard (segment selector, preview, send)
- Auto-posting blasts to the activity feed
- Rate limits + anti-spam guardrails + cohost permissions
- Re-engagement triggers for trips that stall mid-planning

---

## What's NOT in v1 (high-level)

Parked items, in summary — full detail in the Future State section below:
- **On-trip mode** — live itinerary, real-time photos, location sharing → v2
- **Post-trip recap** — Retro tab, photo recap, re-engagement loop → v2
- **Native general cost splitting** — link to Splitwise for now → v2
- **Integrated booking + affiliate revenue** → v2
- **Two-way conversational SMS + inbound parsing** → v2 (cost-blocked until revenue)
- **Mobile app** → v3
- **Deep social graph** — world map, badges, leaderboards, public discovery → v3

The data model is built to accommodate all of these — schema-safety rule means we evolve forward by adding tables, never refactor.

---

## Future state — v2 and v3

*Captured here so we don't forget. This isn't a build plan, it's a memory. We'll re-evaluate priorities at the end of v1 alpha based on what users actually need.*

### v2 — Monetize and complete the lifecycle

**Theme:** revenue-positive product, full trip lifecycle covered, agent becomes conversational.

- **Integrated booking with affiliate / commission revenue** — in-app booking flow for Airbnb, VRBO, Booking, Google Flights or direct airline. The "deep-link out" of v1 becomes "stay in app and Rally takes a cut." This is the primary monetization unlock.
- **Two-way conversational SMS** — invitees can reply to the agent. Profile capture, voting, booking detail entry, preference updates can all happen via text. Revives the parked cases from the 95-case edge case catalog (inbound parsing).
- **Native general cost splitting** — beyond just lodging. Flights, group meals, activities, ground transport, shared expenses. Splitwise functionality, native, settled inside Rally.
- **On-trip mode** — live itinerary, real-time photo upload, location sharing, "you've arrived" auto-states, day-of restaurant/activity confirmations, group chat overlay (maybe).
- **Post-trip recap + re-engagement loop** — automatic photo-album recap, "lessons learned" / Retro capture from the original sheet, "let's do it again" CTA that births the next trip from the previous group. This is where the social graph compounds.

### v3 — Mobile + deep social

**Theme:** full-platform expansion + the social product Rally always wanted to be.

- **Mobile app (iOS + Android)** — feature parity with web, UX reimagined per form factor (not a webview port). Adds native affordances: push, camera, calendar deep links, location. May begin partway through v2 build as a parallel design+engineering track since it's a long lift, but ships under the v3 banner.
- **Deeper social graph** — world map of places visited, trip badges, leaderboards, persistent profile pages, "people you've traveled with most" surfaces.
- **Public trip discovery** — for trips marked public, browse what your network is planning. Could open Rally to a discovery / inspiration use case beyond closed-group planning.
- **Platform / partnerships** — anything that comes from corp dev conversations: data partnerships, embedded experiences inside airlines / OTAs / hotel brands, white-label trip planning for travel partners.

---

## Data model — the user-centric shift

For the social graph, persistent profiles, and trip history to work, the model has to be **user-centric**, not trip-centric. The implication for your existing Supabase schema:

- **Users** are first-class — persistent identity, profile, mutuals, history
- **Trips** belong to users (planner) and are joined via memberships
- **Memberships** carry per-trip RSVP + per-trip travel details (flight, room, etc.)
- **Travel Profiles** belong to users, applied across all trips
- **Coordination tables** (lodging, travel arrangements, meals, itinerary items, votes, shopping items) attach to trips
- **Aggregations** are computed views across memberships, not stored

Your shared users table is already doing the right thing. The schema-safety rule (never drop, never rename) means we evolve forward by adding tables — no breaking refactors.

---

## Working backward — what's reusable

### Fully reusable (keep building)
- Supabase project + users table — this is the spine, already shared between mobile and SMS agent
- Twilio long code + A2P 10DLC registration — paid for, in carrier review, reusable
- TripWebView in Next.js — becomes the v1 web app, expands into the full surface
- SMS Agent infrastructure — becomes the v1 outbound SMS rail
- Step 0 schema inspection requirement — keeps schema safe through evolution
- Gemini + Google Search grounding for flight data — powers booking links + AI itinerary

### Partly reusable (port the logic, drop the UI)
- Travel preferences taxonomy from the Expo app — ports into the web Travel Profile flow
- Booking deep link generation logic
- AI itinerary prompts and generation scaffolding
- Preference aggregation logic (alignment / misalignment surfacing)
- **95-case edge case catalog** — re-prioritize for v1: outbound voice/timing cases stay in scope; inbound parsing cases get parked until two-way SMS comes back post-monetization

### Shelved (do not iterate)
- Expo app UI / navigation / screens — paused
- Planner-poll flow — replaced by invitation-first model
- Anything that assumed mobile-first as the primary surface
- Inbound free-text parsing for the SMS agent — parked until monetization

---

## Design principles (the FUN bar)

The Partiful screenshots make this clearer than I could describe in words. The strategy is: **hide the form inside the vibes**. A trip invitation has the same fields as a Google Form, but it lands as a flyer. The dashboard has the same data as a Google Sheet, but it feels like opening a planning room with friends already inside.

For v1, the design bar is:
- **Invitation page** — overinvest. This is where commitment lives or dies.
- **Profile capture** — overinvest. The first 25 seconds of every new user's life in Rally. Must feel like a vibe quiz, not a form. Tap-driven, swipe-driven, visual. If this isn't FUN, the required-at-first-RSVP model breaks and the whole AI-driven dashboard loses its data spine.
- **Voting moments** — overinvest. This is where social delight happens. Live tallies, friend reactions, comments.
- **Dashboard** — clean, warm, functional. Not minimalist, but not overdesigned. Spreadsheet-replacing means readable first, beautiful second.
- **SMS agent voice** — playful, not formal. "Bri 👀 you haven't said yes yet — Tulum without you would be a crime" not "Hi Bri, please RSVP."
- **Everywhere else** — functional and not annoying. We don't have to make every pixel sing. We have to make the moments that matter sing.

**Mobile-first web (v1 constraint):** most invitees open the trip link from iMessage on their phone. Design web mobile-first responsive, and avoid web patterns that won't translate to native (no hover-as-primary, no keyboard-driven flows, no desktop-only layouts). The dashboard is the one surface where desktop layout still matters — planners use laptops to plan. Everything else is mobile-first. This is the v1 prep that makes the eventual v3 mobile app a smaller leap.

---

## All previously-open questions are now resolved

For the record:
1. **Phase B prioritization** → Path A (wow-first), order locked: Flyer → Itinerary → Lodging → Travel → Meals → Shopping → Clone
2. **Shopping list lift** → in scope, ships after Meals (it's the magic feature; engineering chunk is worth it)
3. **Profile capture timing** → required at first RSVP forever, Tinder-style sub-30-second, one-tap confirm on returning RSVPs
4. **Mutuals depth in Phase A** → minimal-then-upgrade (checkbox list in Phase A, filters/sort in Phase B)
5. **Private blast replies** → deferred (text the planner directly)
6. **Blast rate limits** → 3/week, 10/trip
7. **Generate Flyer in v1** → yes, Phase B (first feature in build order)
8. **Clone Trip in v1** → yes, Phase B, cheap-or-cut

## Risks to watch as we move to build

- **Profile capture quality is load-bearing.** The required-at-RSVP model assumes sub-30-second tap-driven capture. If we can't ship the profile at that quality bar, we have to revert to "prompted, not required" and the AI engine works with thinner data. Worth prototyping the profile flow *first* in design before locking the model.
- **Empty-profile graceful degradation.** Every AI-drafted tab needs to handle partial group data without breaking. This is a Phase B-wide design constraint, not a single feature.
- **AI quality across diverse trips.** Itinerary, lodging, meals AI all need to handle wildly different trip types (ski / beach / bachelor / family / international). Test fixtures should cover the breadth, not just one trip archetype.
- **Mutuals minimal version stays minimal.** Scope creep risk — feature-rich invite picker is tempting but Phase A has to ship lean. Resist.
- **Generate Flyer aesthetic bar.** The growth lever depends on the flyer being genuinely shareable. A "meh" templated flyer is worse than no flyer — it's an anti-marketing surface. Set the design bar high or cut it.

---

## What's next

Scope is locked. Time to draft the Phase A build plan:

- Schema additions needed for v1 (users, trips, memberships, profiles, mutuals)
- Phase A screen-by-screen inventory (invitation page, profile capture, RSVP flow, returning-user confirmation, roster, activity feed)
- Phase A SMS triggers (RSVP nudge only — profile and booking nudges land in Phase C)
- Dependencies and sequencing within Phase A
- Test plan drawing from the 95-case catalog (outbound voice/timing cases)
- Definition of "alpha-ready" and what we'll measure to know if the commitment wedge is working

Ready when you are.
