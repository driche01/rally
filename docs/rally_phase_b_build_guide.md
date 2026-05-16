# Rally — Phase B Build Guide

> **For: Claude Code**
> **Source of truth for product decisions:** `rally_v1_scope.md`
> **Prerequisite:** Phase A is complete, signed off on localhost, and deployed for alpha testing (or at minimum, locked from further changes)
> **Scope of this guide:** Phase B only — the AI-drafted dashboard. Mobile app code (Expo) is NOT touched.

---

## What this guide is

Phase B turns Rally from "RSVP collector" into "Google Sheet replacement that builds itself." Every dashboard surface is AI-drafted from aggregated travel profile data, then edited and voted on by the group.

The same working agreement and question-surfacing protocol from Phase A apply here. Re-read Section 2 of the Phase A guide if needed.

---

## Phase 0 — Learn from Phase A (MANDATORY)

Before any Phase B work begins:

1. **Read the Phase A `PHASE_A_DEMO.md`.** Understand what was built and how it behaves.
2. **Read the Phase A `BUILD_QUESTIONS.md`.** Every RESOLVED entry is now precedent. Don't re-litigate decisions; build on them.
3. **Re-run the Phase A `SCHEMA_REPORT.md` query** to capture the current state of the schema as it exists after Phase A migrations.
4. **Read what's actually in the codebase.** Check `/web`, `/api`, `/sms-agent`, and `/shared`. Note any deviations from the Phase A guide that survived to production — those are now the truth, not the guide.
5. **Reconcile this guide's plans with Phase A's reality.** For each section below, ask:
   - Does the schema this section needs conflict with what Phase A shipped?
   - Does the API pattern this section uses match the Phase A pattern, or differ for a reason?
   - Did Phase A surface any user feedback (in `PHASE_A_DEMO.md` notes or in alpha tester comments) that should change this section's plan?
6. **Write `PHASE_B_PRE_BUILD_REVIEW.md`** with:
   - What you learned from Phase A
   - Any new conflicts surfaced between this guide and the post-Phase-A reality
   - Recommendations for resolving each
7. **STOP. Wait for human review of `PHASE_B_PRE_BUILD_REVIEW.md` before proceeding.**

Examples of conflicts to surface (not exhaustive):
- A profile vibe question was renamed during the Design Gate, and this guide still references the old name
- The activity feed API was structured differently than this guide assumes
- An alpha tester said the profile took 45 seconds to complete and we need to revisit the model
- The mutuals table was deferred and never built in Phase A

The Phase 0 review is the protection against this guide being wrong because reality moved.

---

## 1. Step 0 — Schema inspection (still mandatory)

Same as Phase A. Run before any backend work in Phase B. Reconcile the Phase B schema additions in Section 3 against what now exists in production. Same rules: additive only, never drop, never rename. Save to `SCHEMA_REPORT.md` (overwrite) and `SCHEMA_PLAN.md` (overwrite with Phase B's plan).

---

## 2. Phase B build order (LOCKED)

This is Path A — wow-first prioritization. Build in this exact order:

1. **Profile aggregation engine** (Phase B prerequisite — see Section 4)
2. **Generate Flyer** (cheapest, most viral, ships first)
3. **Itinerary tab** + AI generation + voting (the hero FUN moment)
4. **Lodging tab** + AI-suggested options + room assignments + cost split-out
5. **Travel tab** + AI-coordinated arrival timing + car groupings + flight capture
6. **Meals tab** + AI-suggested meal plan + dietary surfacing + voting
7. **Shopping List** — auto-deduplicated from Meals (depends on Meals shipping first)
8. **Clone Trip** — cheap-or-cut; if it takes more than a few days, drop without re-litigation

Other things landing in Phase B:
- Booking deep links across Lodging and Travel tabs (not standalone work)
- Manage Guests / Roster filter and sort upgrades from minimal to richer
- Mutuals upgrade from minimal checklist to filterable/sortable
- Returning-user one-tap profile confirmation (if not fully shipped in Phase A — verify in Phase 0)

---

## 3. Phase B schema additions

All additive. Reconcile against the post-Phase-A schema in Step 0.

**`itinerary_items`**
- `id` uuid PK
- `trip_id` uuid references `trips.id`
- `day_number` integer
- `start_time` time nullable
- `end_time` time nullable
- `title` text
- `description` text nullable
- `location_name` text nullable
- `location_url` text nullable
- `category` enum: `activity`, `meal`, `transit`, `lodging`, `free_time`, `other`
- `ai_generated` boolean default false
- `created_by` uuid references `users.id`
- `created_at`, `updated_at` timestamps

**`itinerary_item_votes`**
- `item_id` uuid references `itinerary_items.id`
- `user_id` uuid references `users.id`
- `vote` enum: `yes`, `no`, `maybe`
- `voted_at` timestamp
- Composite PK (item_id, user_id)

**`itinerary_item_alternatives`** — for "vote between option A or B"
- `id` uuid PK
- `trip_id` uuid references `trips.id`
- `day_number` integer
- `slot_label` text (e.g. "Saturday dinner")
- Optional pointer to a "winning" item after voting closes

**`itinerary_alternative_options`**
- `alternative_id` uuid references `itinerary_item_alternatives.id`
- `item_id` uuid references `itinerary_items.id`
- Composite PK

**`lodging_options`**
- `id` uuid PK
- `trip_id` uuid references `trips.id`
- `name` text
- `provider` enum: `airbnb`, `vrbo`, `booking`, `hotel`, `other`
- `external_url` text
- `cost_total` numeric nullable
- `cost_per_night` numeric nullable
- `room_layout` jsonb — flexible, e.g. `[{room: "BR1", beds: "1 King", cost_per_night: 136}, ...]`
- `ai_suggested` boolean default false
- `is_selected` boolean default false — the chosen option for the trip
- `created_at`, `updated_at` timestamps

**`lodging_room_assignments`**
- `id` uuid PK
- `lodging_option_id` uuid references `lodging_options.id`
- `room_label` text (matches a key in `room_layout`)
- `user_id` uuid references `users.id`
- `nights` integer
- `cost_owed` numeric
- `payment_status` enum: `unpaid`, `pending`, `paid`
- `created_at`, `updated_at` timestamps

**`travel_arrangements`**
- `id` uuid PK
- `trip_id` uuid references `trips.id`
- `user_id` uuid references `users.id`
- `arrival_mode` enum: `flight`, `drive`, `train`, `other`
- `arrival_datetime` timestamp nullable
- `departure_datetime` timestamp nullable
- `flight_number` text nullable
- `flight_origin_airport` text nullable
- `flight_destination_airport` text nullable
- `vehicle_capacity` integer nullable — for drivers
- `gear_notes` text nullable
- `created_at`, `updated_at` timestamps

**`travel_groupings`** — for shared rides
- `id` uuid PK
- `trip_id` uuid references `trips.id`
- `driver_user_id` uuid references `users.id`
- `departure_datetime` timestamp
- `direction` enum: `outbound`, `return`
- `notes` text nullable

**`travel_grouping_members`**
- `grouping_id` uuid references `travel_groupings.id`
- `user_id` uuid references `users.id`
- Composite PK

**`meals`**
- `id` uuid PK
- `trip_id` uuid references `trips.id`
- `day_number` integer
- `meal_type` enum: `breakfast`, `lunch`, `dinner`, `snack`
- `mode` enum: `cook_in`, `restaurant`, `tbd`
- `recipe_name` text nullable
- `restaurant_name` text nullable
- `restaurant_url` text nullable
- `assigned_cook_user_ids` uuid[] nullable
- `notes` text nullable
- `ai_suggested` boolean default false
- `created_at`, `updated_at` timestamps

**`meal_ingredients`**
- `id` uuid PK
- `meal_id` uuid references `meals.id`
- `name` text — normalized ingredient name
- `quantity` numeric
- `unit` text — e.g. "lb", "cloves", "head", "can"
- `category` enum: `produce`, `meat_fish`, `dairy_fridge`, `pantry`, `other`

**`shopping_list_items`** — derived from meal_ingredients, computed/cached
- `id` uuid PK
- `trip_id` uuid references `trips.id`
- `name` text
- `total_quantity` numeric
- `unit` text
- `category` enum (same as `meal_ingredients`)
- `assigned_to_user_id` uuid references `users.id` nullable
- `is_acquired` boolean default false
- `source_meal_ids` uuid[] — which meals contributed to this item

**`meal_votes`** and **`lodging_option_votes`** — same shape as `itinerary_item_votes`, scoped to meals and lodging respectively

**`trip_flyers`** — for Generate Flyer
- `id` uuid PK
- `trip_id` uuid references `trips.id`
- `template_id` text — which template was used
- `cover_image_url` text
- `rendered_image_url` text — the exported flyer image
- `generated_at` timestamp

### Phase B indexes
- `itinerary_items`: `(trip_id, day_number, start_time)`
- `shopping_list_items`: `(trip_id, category, name)`
- `meals`: `(trip_id, day_number, meal_type)`
- `travel_arrangements`: `(trip_id, user_id)`
- `lodging_room_assignments`: `(lodging_option_id)`, `(user_id)`

---

## 4. The profile aggregation engine (Phase B prerequisite)

This ships first because every other Phase B feature consumes it.

### What it does
Takes the travel profiles of all `going` members of a trip and produces structured aggregate data that AI prompts can use.

### Output shape (example)
```json
{
  "trip_id": "...",
  "going_count": 8,
  "profile_complete_count": 6,
  "profile_incomplete_count": 2,
  "vibes": {
    "beach_vs_mountain": { "beach": 5, "mountain": 1, "both": 0, "skewed": "beach" },
    "social_vs_chill": { "social": 2, "chill": 6, "both": 0, "skewed": "chill" }
    // ... etc for each vibe dimension
  },
  "dietary_restrictions": ["gluten-free", "no shellfish", "vegetarian"],
  "home_airports": ["SFO", "OAK", "LAX", "JFK"],
  "budget_comfort": { "budget": 1, "mid": 5, "premium": 2, "luxury": 0, "skewed": "mid" },
  "alignment_summary": "Strong alignment: chill, foodie, mid-budget. Misalignment: spa vs. hike (4 vs. 4)."
}
```

### Endpoint
`GET /api/trips/:id/profile-aggregate` — returns the structure above, computed on demand. Cache for 5 minutes per trip; invalidate on RSVP change or profile edit.

### Empty-profile handling
- If `going_count` is 0: every consuming feature shows an empty state ("Invite people to start planning")
- If `profile_complete_count` is low (less than 50%): consuming features show the AI-generated draft but with a disclaimer ("Based on early data — will refine as more friends join")
- AI prompts always include `profile_incomplete_count` in context so the model can hedge appropriately

---

## 5. Phase B build sequence (after Phase 0 review approval)

### Step 1 — Schema migration
Execute Phase B additive DDL. Same rules as Phase A.

### Step 2 — Profile aggregation engine
Build the endpoint and its underlying service. Unit test with synthetic profiles covering edge cases (all aligned, fully split, partially complete, all incomplete).

### Step 3 — Generate Flyer
- Templated MVP: pick from N curated background images (or use the trip's cover image)
- Overlay trip name, dates, hosts (with avatars), RSVP link as QR code
- Export as a 1080x1920 image (Instagram story size) and a 1080x1080 image (Instagram post size)
- Server-side rendering preferred; client-side canvas acceptable
- Surface as a "Make Flyer" button in the trip page More menu
- Aesthetic bar is high — a "meh" flyer is anti-marketing. If the templates aren't shipping at quality, surface to the human via `BUILD_QUESTIONS.md`.

### Step 4 — Itinerary tab + AI + voting
- New tab in the trip dashboard
- "Generate Itinerary" button (host/cohost only) — calls Anthropic API with profile aggregate as input, returns N items grouped by day
- Render the items in a day-by-day timeline view
- Each item supports yes/no/maybe voting from all `going` members (live tally visible)
- Host can edit, reorder, delete, add manual items
- "Alternatives" pattern: for high-stakes slots (e.g. Saturday dinner), AI can propose 2-3 options grouped, group votes between them
- Real-time vote updates if feasible

### Step 5 — Lodging tab
- "Find Lodging" button — calls Anthropic API (or Gemini with grounding) with profile aggregate + destination + dates + group size → returns 3-5 suggested options with provider links
- Planner picks one as "Selected"
- Room layout UI — drag-drop assignment of members to rooms
- Per-person cost calculation from `cost_per_night` × `nights` × assignment
- Payment status tracking (no native payment in v1 — link out to Splitwise for actual settlement)
- Voting on lodging options (before selection)

### Step 6 — Travel tab
- Each `going` member has a card to fill in their travel arrangement (flight, drive, etc.)
- "Suggest Flights" button per member — Gemini + Google Search grounding from their `home_airport` to the destination on the trip dates; deep links to Google Flights
- Car groupings UI — host creates groupings, assigns members
- Arrival/departure timeline view (visualize when everyone shows up)

### Step 7 — Meals tab
- "Generate Meal Plan" button — calls Anthropic API with profile aggregate (heavy use of dietary + vibe) → returns meal plan covering breakfast/lunch/dinner per trip day
- Per meal: cook-in vs. restaurant mode, recipe or restaurant name, assigned cooks, voting
- Restaurant suggestions surface destination-appropriate options

### Step 8 — Shopping list (the magic feature)
- Triggered automatically whenever a cook-in meal is added/edited
- Aggregates `meal_ingredients` across all cook-in meals
- Deduplication logic: normalize ingredient names (case-insensitive, plural/singular), sum quantities where units match, surface unit conflicts for human resolution
- Categorize by `produce` / `meat_fish` / `dairy_fridge` / `pantry`
- Assignment UI — drag items to people, mark acquired
- This is the wow moment. The quality of the deduplication is the feature. If ingredient normalization is fuzzy or wrong, the moment lands flat. Test thoroughly with the ski trip sheet data as fixture input.

### Step 9 — Clone Trip
- Cheap-or-cut decision happens here. Set a budget: if Clone takes more than 3 days, drop and add to backlog.
- Cheap version: duplicate `trips` row, duplicate cohosts, do NOT copy memberships (clean invite list), do NOT copy itinerary/lodging/travel/meals/shopping (clean planning). Copy the cover, theme, name (with " (copy)" appended), description, budget.
- If trip data model is structured so this is straightforward, ship it. If not, write to `BUILD_QUESTIONS.md` with the friction and ship to backlog.

### Step 10 — Roster and Mutuals upgrades
- Roster: add filter chips by RSVP status, sort by name/profile-complete/recently-active, search
- Mutuals: upgrade the invite flow's past-trip-mates from a flat checkbox list to filterable (by past trip) + sortable (most recent / most shared trips / alphabetical) + searchable

---

## 6. Phase B definition of done

**The dashboard exists and builds itself.**

- [ ] Profile aggregation engine endpoint exists, returns correct shape, handles empty/partial data
- [ ] Generate Flyer produces shareable images for trips, at a quality bar the human signs off on
- [ ] Itinerary tab: AI generation, voting, manual edits, alternatives all work
- [ ] Lodging tab: AI suggestions, room assignments, cost split out, Splitwise link
- [ ] Travel tab: per-member arrangements, flight suggestions via Gemini, car groupings, timeline view
- [ ] Meals tab: AI meal plan, cook-in vs. restaurant, dietary surfacing, voting
- [ ] Shopping list: auto-deduplicated, categorized, assignable, marked-acquired
- [ ] Booking deep links live across Lodging and Travel tabs
- [ ] Clone Trip ships OR is documented in `BUILD_QUESTIONS.md` as cut-for-cost
- [ ] Roster filter/sort/search upgrades shipped
- [ ] Mutuals filter/sort/search upgrades shipped
- [ ] All schema additions additive
- [ ] Mobile-first responsive — works in phone viewport
- [ ] Empty-profile graceful degradation everywhere AI is consumed
- [ ] `BUILD_QUESTIONS.md` either empty or all RESOLVED
- [ ] `PHASE_B_PRE_BUILD_REVIEW.md` filed and reviewed before build started
- [ ] `PHASE_B_DEMO.md` written for localhost handoff

**What's explicitly NOT in Phase B:**
- [ ] Planner blasts / blast composer (Phase C)
- [ ] SMS reminders beyond Phase A's RSVP nudge (Phase C)
- [ ] Two-way SMS (parked until v2)
- [ ] Integrated booking with commission (v2)
- [ ] Native cost splitting beyond lodging (v2)
- [ ] On-trip mode (v2)
- [ ] Post-trip recap (v2)
- [ ] Anything in Future State v3

---

## 7. Localhost handoff

Same protocol as Phase A:
1. Run full Phase B flow end-to-end on localhost — create trip, invite 5 people, all complete profiles, generate itinerary/lodging/meals, vote, build shopping list, generate flyer
2. Write `PHASE_B_DEMO.md` with run instructions, test scenario, known issues, resolved questions
3. Notify human, **STOP**, wait for sign-off before Phase C
