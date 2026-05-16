# Rally — Phase A Build Guide

> **For: Claude Code**
> **Source of truth for product decisions:** `rally_v1_scope.md`
> **Scope of this guide:** Phase A only — backend schema, Twilio text engine, Next.js web experience. Mobile app code (Expo) is NOT touched.

---

## What this guide is

An executable plan to build Phase A of Rally v1: the invitation + profile + roster wedge proof. The goal is to ship something we can put in front of alpha testers on localhost first, then production. Phases B and C have their own guides — do not build forward into them.

## Working agreement

1. **Read this guide top to bottom before writing any code.** Then read it again.
2. **Step 0 (schema inspection) is mandatory and non-negotiable.** Run it before any backend work.
3. **The Design Gate (Section 5) is a hard stop.** Stop and wait for human review at that point.
4. **When you have a question or face a tradeoff, do not guess.** Use the question-surfacing protocol (Section 2).
5. **Never drop or rename existing database columns.** Only add. The schema is shared with the mobile app and must evolve forward.
6. **Do not touch `/mobile`, `/expo`, or any iOS/Android code.** Schema, `/api`, Twilio agent code, and `/web` (Next.js TripWebView) only.

---

## 1. Step 0 — Schema inspection (MANDATORY)

Before any application code is written, do the following:

1. Query `information_schema.tables`, `information_schema.columns`, and `information_schema.table_constraints` against the hosted Supabase project.
2. Print a full report listing every existing table, every column with type/nullability/default, and every constraint (PK, FK, unique, check).
3. Reconcile against the Phase A schema additions in Section 4 below. For each table needed in Phase A:
   - If it does NOT exist → flag as "TO CREATE."
   - If it EXISTS but is missing columns Phase A needs → flag as "TO EXTEND (additive only)."
   - If it EXISTS and Phase A would want to rename or drop something → **STOP. Write the conflict to `BUILD_QUESTIONS.md` and wait for human input.** Never drop, never rename.
4. Save the report to `SCHEMA_REPORT.md` in the repo root.
5. Save the planned additive changes (DDL preview, no execution yet) to `SCHEMA_PLAN.md`.
6. Pause and wait for human confirmation of `SCHEMA_PLAN.md` before running any migrations.

This block is the existing safety contract from the previous build tooling. It does not get skipped or modified.

---

## 2. Question-surfacing protocol

When you encounter a tradeoff, ambiguity, or implementation decision that isn't fully specified in this guide OR in `rally_v1_scope.md`:

1. **Do not guess.** Do not pick the "reasonable default" silently.
2. Append the question to `BUILD_QUESTIONS.md` in the repo root, using this format:

   ```
   ## Q[number]: [Short title]
   **Context:** Where in the build you hit this.
   **The question:** What needs to be decided.
   **Options:** 2-3 concrete options.
   **Tradeoffs:** What each option costs/buys.
   **Your recommendation:** Pick one, briefly justify.
   **Status:** AWAITING HUMAN INPUT
   ```

3. Continue work on anything that's NOT blocked by the question.
4. When the human responds, update the entry's status to `RESOLVED: [decision]` and proceed.

Examples of things to ask about (not guess):
- A schema reconciliation conflict
- An ambiguity in how a feature should behave on edge cases
- A library/framework choice not specified in the existing codebase
- Anything that would require touching mobile app code to complete

Examples of things to NOT ask about (just do):
- Naming a CSS class
- Picking an icon for a button
- Writing a SQL index for a query you already know is slow

---

## 3. What gets touched, what doesn't

### Touched
- **Supabase schema** — additive evolutions only
- **`/web`** — Next.js TripWebView codebase, where the v1 web app lives
- **`/api`** or equivalent — server-side endpoints the web app and SMS agent both call
- **`/sms-agent`** — Twilio-integrated outbound SMS service (existing infra, extended)
- **`/shared`** — any shared types, utils, or models between web and SMS agent

### NOT touched
- **`/mobile`, `/expo`, anything iOS/Android-related** — the Expo app is paused
- **No new third-party services** without surfacing the question first (we already use Supabase, Twilio, Anthropic, Gemini)
- **Existing tables' existing columns** — additive only

---

## 4. Phase A schema additions

Goal: support invitations, RSVPs, persistent travel profiles, mutuals, and the activity feed.

### Existing tables (do NOT modify unless additively)

- **`users`** — already exists, shared with mobile. Phase A needs: a `default_travel_profile_id` foreign key (nullable, references `travel_profiles.id`). Add only if not present.

### New tables (create if not present)

**`trips`**
- `id` uuid primary key
- `created_by` uuid references `users.id`
- `name` text
- `destination` text (free text for v1; structured location is parked)
- `start_date` date nullable
- `end_date` date nullable
- `budget_min` numeric nullable
- `budget_max` numeric nullable
- `theme` text — invitation page template choice
- `cover_image_url` text nullable
- `description` text nullable
- `is_public` boolean default false
- `created_at`, `updated_at` timestamps

**`trip_cohosts`**
- `trip_id` uuid references `trips.id`
- `user_id` uuid references `users.id`
- `created_at` timestamp
- Composite PK (trip_id, user_id)

**`trip_memberships`** — the join table for RSVPs
- `id` uuid primary key
- `trip_id` uuid references `trips.id`
- `user_id` uuid references `users.id` nullable (nullable because someone can be invited via phone/email before they have a user account)
- `phone` text nullable — for pre-user invitees
- `email` text nullable — for pre-user invitees
- `display_name` text — what's shown until they create a profile
- `rsvp_status` enum: `invited`, `going`, `maybe`, `cant_go`
- `rsvp_updated_at` timestamp
- `invited_by` uuid references `users.id`
- `invited_at` timestamp
- `created_at`, `updated_at` timestamps
- Constraint: at least one of (user_id, phone, email) must be non-null

**`travel_profiles`**
- `id` uuid primary key
- `user_id` uuid references `users.id`
- `home_airport` text nullable
- `vibe_beach_or_mountain` enum: `beach`, `mountain`, `both`
- `vibe_spa_or_hike` enum: `spa`, `hike`, `both`
- `vibe_foodie_or_casual` enum: `foodie`, `casual`, `both`
- `vibe_social_or_chill` enum: `social`, `chill`, `both`
- `vibe_culture_or_relaxation` enum: `culture`, `relaxation`, `both`
- `dietary_restrictions` text[] nullable
- `budget_comfort` enum: `budget`, `mid`, `premium`, `luxury` nullable
- `created_at`, `updated_at` timestamps
- One profile per user (unique on user_id)

> **Note on the profile schema:** the exact vibe questions above are a draft. The Design Gate (Section 5) may revise them based on the prototype. Schema should be flexible enough that adding/removing a vibe field doesn't require dropping columns — prefer additively adding new fields and ignoring deprecated ones over renames.

**`activity_feed_entries`**
- `id` uuid primary key
- `trip_id` uuid references `trips.id`
- `user_id` uuid references `users.id` nullable (nullable for system entries)
- `entry_type` enum: `rsvp_update`, `comment`, `gif`, `photo`, `system`, `planner_post`
- `content` jsonb — flexible payload per entry_type
- `created_at` timestamp

**`mutuals`** — derived/cached for fast invite-flow lookups; can also be computed on the fly in Phase A
- `user_id` uuid references `users.id`
- `mutual_user_id` uuid references `users.id`
- `shared_trip_count` integer
- `last_traveled_together_at` timestamp nullable
- Composite PK (user_id, mutual_user_id)

**`sms_messages`** — for tracking outbound sends, rate limits, and debugging
- `id` uuid primary key
- `trip_id` uuid references `trips.id` nullable
- `recipient_user_id` uuid references `users.id` nullable
- `recipient_phone` text
- `message_body` text
- `message_type` enum: `rsvp_nudge`, `profile_completion`, `booking_nudge`, `pre_trip_summary`, `planner_blast`
- `sent_at` timestamp
- `twilio_sid` text nullable
- `status` enum: `pending`, `sent`, `delivered`, `failed`
- `created_at` timestamp

### Phase A indexes

- `trip_memberships`: index on `(trip_id, rsvp_status)`, index on `phone`, index on `email`
- `activity_feed_entries`: index on `(trip_id, created_at desc)`
- `sms_messages`: index on `(recipient_user_id, sent_at desc)`, index on `(trip_id, message_type, sent_at desc)`
- `mutuals`: index on `(user_id, shared_trip_count desc)`

---

## 5. Design Gate — STOP HERE FOR HUMAN REVIEW

After Step 0 (schema inspection) is approved and before any backend work begins, build a **standalone HTML/CSS/JS prototype** of the **travel profile capture flow** in `/web/prototype/profile-capture/`.

### Why this exists
The required-at-first-RSVP profile model is load-bearing. If the capture flow can't ship at sub-30-second, tap-driven, visually fun quality, the entire AI-driven dashboard loses its data spine. Validate the experience before building the engine that depends on it.

### What to build
- A self-contained page that simulates the profile capture flow
- Tinder-style swipe/tap cards for each vibe question
- Typeahead for home airport (mock data is fine)
- Multi-select chips for dietary
- Tier picker for budget comfort
- Final "you're all set" screen
- A timer in the corner showing how long the flow takes
- No backend wiring. Pure frontend. Mock data only.

### Acceptance criteria for this gate
- Completion time end-to-end under 30 seconds for a test user
- No typing required except home airport
- Feels like a vibe quiz, not a form
- Works on mobile web (test in mobile Chrome / Safari viewport)

### What happens at the gate
1. Push the prototype to localhost
2. Update `BUILD_QUESTIONS.md` with a new entry: "Design Gate: profile capture prototype ready for review at [localhost path]"
3. **STOP. Wait for human approval before proceeding.**
4. Human review may revise the vibe questions, the visual treatment, or the flow ordering. Update the prototype until approved.
5. Only after approval is the profile capture flow integrated into the real RSVP flow. The approved prototype becomes the spec.

---

## 6. Phase A build sequence (after Design Gate approval)

Build in this order. Each step has a verification check before moving to the next.

### Step 1 — Schema migration
- Execute the additive DDL from `SCHEMA_PLAN.md`
- Run migration against hosted Supabase
- Verify with a fresh `information_schema` query that all expected tables and columns exist
- Commit migration files

### Step 2 — Backend API skeleton
- `/api/trips` — create, read, update (no delete in Phase A; trip cancellation is in Phase C)
- `/api/trips/:id/invitations` — send invitations (link/contacts/email/past-trip-mates)
- `/api/trips/:id/memberships` — RSVP update, host RSVP override
- `/api/users/me/profile` — get, create, update travel profile
- `/api/trips/:id/activity` — read feed, post comment
- `/api/mutuals` — list user's past trip-mates
- All endpoints behind auth, except read-only invite page (which uses an invite token)

### Step 3 — Trip creation flow (planner)
- Form for name, destination, dates, budget range, theme picker, description, cover image
- Save as draft / publish toggle
- Redirect to trip page once published

### Step 4 — Invitation page (the public-facing surface)
- Themed templates (Classic / Eclectic / Fancy / Literary / Digital / Elegant)
- Trip details, hosted by, location, cost-per-person estimate
- Guest list with avatars + count
- Photo album (placeholder OK for Phase A; upload can be Phase B)
- Activity feed (RSVPs, comments, GIFs)
- Mobile-first responsive — test in mobile viewport
- Emoji RSVP buttons (Going / Maybe / Can't Go)

### Step 5 — RSVP flow + profile capture integration
- Tapping Going / Maybe / Can't Go on the invitation page:
  - First time user: triggers the **approved profile capture flow** (the prototype from Section 5, now wired to the API)
  - Returning user with existing profile: shows the **one-tap confirm** flow ("Here's your travel profile — looks right? [Yes, RSVP] / [Edit first]")
  - Profile is required for first RSVP, ever. Not for first RSVP per trip — first RSVP per user.
- On completion, RSVP status updates, activity feed posts an entry

### Step 6 — Send invitations flow
- "Invite" modal on the trip page (host/cohost only)
- Search input
- Past trip-mates list (minimal version — checkbox list, sorted by most recently traveled with)
- Multi-channel send: copy link, add from phone contacts, email invite, generate flyer (defer flyer to Phase B; Phase A just shows the button as disabled with a "coming soon" tooltip)
- Custom message composer with character limit (480, matching Partiful)
- Send → creates `trip_membership` records with `rsvp_status = invited`, fires invitation SMS via the agent

### Step 7 — Roster (dashboard v0)
- Host-only view inside the trip page
- List of all memberships, RSVP status, profile snapshot (vibe summary)
- Filterable by status, searchable, sortable
- Host can override RSVP on someone's behalf
- "Only visible to hosts" label

### Step 8 — SMS agent: RSVP nudge only
- Outbound-only, 1:1, never to a group
- Auto Reminder type: `rsvp_nudge` — fires to invitees with status `invited` or `maybe` on a schedule (default: 3 days after invitation if not yet Going)
- Each message ends with a CTA link to the invitation page
- Voice: playful, personal, link-driven (see scope doc for voice principles)
- Record every send in `sms_messages` table
- Other SMS types (profile completion, booking, pre-trip summary, planner blasts) are Phase C — do not build in Phase A

### Step 9 — Activity feed
- Reads from `activity_feed_entries`
- Anyone can post a comment or GIF (GIF integration: use Tenor or Giphy API — surface as a question if not already configured)
- RSVP changes auto-post system entries
- Real-time updates if feasible (Supabase realtime); polling fallback otherwise

### Step 10 — Mutuals integration
- After someone completes a trip (Phase A: after RSVP, since trips don't "complete" yet), populate `mutuals` rows linking them to other members of trips they share
- Surface the mutuals list in the invite flow's "Past guests" tab

---

## 7. Phase A definition of done

The wedge proof. The whole and only goal of Phase A.

**A planner can:**
- [ ] Create a trip with destination, dates, budget, theme, description, cover image
- [ ] Send invitations via link, contacts, email, or past-trip-mates checklist
- [ ] See a Roster of all invitees with RSVP status and profile snapshots
- [ ] Override an RSVP on someone's behalf
- [ ] Post comments to the activity feed
- [ ] See real-time RSVP updates and feed activity

**An invitee can:**
- [ ] Land on the invitation page from a link (no login required to view)
- [ ] See trip details, host info, guest list, activity feed
- [ ] Tap an RSVP button
- [ ] On first RSVP ever: complete the profile capture flow in under 30 seconds
- [ ] On subsequent RSVPs: confirm their existing profile in one tap, or edit
- [ ] Post comments / GIFs to the feed
- [ ] Receive an SMS RSVP nudge if they don't respond within the configured window

**The system:**
- [ ] Profiles persist across trips per user
- [ ] Mutuals populate as users share trips
- [ ] SMS agent sends outbound-only RSVP nudges via Twilio long code, never to a group thread
- [ ] All schema additions are additive — no dropped or renamed columns
- [ ] Mobile-first responsive web — works in a phone viewport without horizontal scrolling
- [ ] `BUILD_QUESTIONS.md` exists and contains either no entries or only RESOLVED entries
- [ ] `SCHEMA_REPORT.md` and `SCHEMA_PLAN.md` exist and reflect the final state

**What's explicitly NOT in Phase A** (do not build):
- [ ] Lodging, Travel, Itinerary, Meals, Shopping List tabs
- [ ] AI-generated drafts of any kind
- [ ] Generate Flyer (disabled button with tooltip is fine)
- [ ] Clone Trip
- [ ] Booking deep links
- [ ] Planner blasts / blast composer
- [ ] SMS auto reminders other than RSVP nudge
- [ ] Cancel trip (trip cancellation is Phase C)
- [ ] Two-way SMS / inbound parsing
- [ ] Profile aggregation engine
- [ ] Anything in the Future State section of the scope doc

---

## 8. Localhost handoff

When Phase A definition of done is met:

1. Run the full Phase A flow end-to-end on localhost — create trip, invite 3 fake invitees with different phone numbers, RSVP each, complete profiles, post to feed, send nudges
2. Write a `PHASE_A_DEMO.md` with:
   - How to run it (`npm run dev` or equivalent)
   - A test scenario script the human can walk through
   - Known issues / rough edges
   - Any RESOLVED questions from `BUILD_QUESTIONS.md` that affected behavior
3. Notify the human that Phase A is ready for localhost review
4. **STOP.** Do not proceed to Phase B until human signs off and a separate Phase B build guide is provided.
