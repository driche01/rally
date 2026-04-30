# Session Handoff — 2026-04-27

Pick-up note for the next session. Read this top-to-bottom before doing
anything else; it captures the product direction, the current state of
the trip-creation/edit experience, what's been deployed, and what
likely comes next.

## TL;DR — where we are

Rally is mid-build on a survey-based 1:1 SMS coordination model. Most of
the backend (cadence engine, recommendation engine, decision queue,
inbox, dashboards, public results, public summary) is built and
running in production. The current focus is **planner-facing UX
polish on the trip-creation and trip-edit forms** — making them feel
fast, clear, and self-explanatory so a non-technical planner can set
up a real trip in under 60 seconds.

The most recent change rewrote `app/(app)/trips/[id]/edit.tsx` to
mirror the new-trip form, pre-filled from the trip's existing state,
with inline warnings when an edit would reset existing poll votes plus
a customizable follow-up SMS that fires on Update.

## Recent product arc (this session)

The trip creation/edit experience evolved through a series of
refinements:

1. **Group size question replaced** with native contact picker
   (`ContactSelector`) — planner picks from real contacts on iOS, falls
   back to manual phone entry on web/Android. Group size derives from
   `contacts.length + 1`.
2. **Per-field option lists** — destination, trip dates, trip length,
   spend per person each support 0/1/2+ semantics:
   - 0 entries → field stays blank, no poll created
   - 1 entry → decided poll (locked answer)
   - 2+ entries → live poll the group votes on
3. **Trip length** uses a number-pill + unit-pill combo
   (1–6 × day/week/month). Selecting both auto-commits the chip;
   selectors clear for the next combo. Singular/plural handled
   automatically.
4. **Trip dates** uses a single `MultiDatePicker` (built from
   `react-native-calendars`) with a mode toggle: **Days / Weekends /
   Weeks / Months**. Tap any day in the relevant mode to toggle the
   whole block. Consecutive days auto-group into ranges via
   `groupConsecutiveDays`. Show-existing-ranges visualization while
   editing.
5. **Spend per person** is multi-select, with a "+ Add custom range"
   inline input for non-standard buckets.
6. **Book-by date** sits just above "Rally's intro text" (with cadence
   preview that lists the exact dates Rally will text non-responders).
7. **Trip-type question removed** entirely. Contacts replaces
   "How many people?".
8. **Poll titles refreshed** to second-person framing:
   - Where do you want to go?
   - How long should the trip be? (multi-select)
   - When are you free? (multi-select, expands to per-day calendar)
   - What's your budget? (travel + lodging only)
   Order on the survey: destination → length → dates → budget.
9. **Survey-side calendar** now lets respondents tap individual days
   they're available within the planner's date windows. Trip-length
   header above the calendar tells them how long the trip will be.
10. **Date heatmap** on the dashboard's `AggregateResultsCard` and the
    public `/results/[token]` page when the dates poll is per-day.
    Shared `<DateHeatmap>` component.
11. **Edit-trip rewrite** — the trip hero on the trip detail screen
    navigates to a new edit form that mirrors new-trip exactly,
    pre-filled. Diff-aware warnings render inline ("4 existing votes
    will be reset") and a customizable "Rally's follow-up text" lives
    at the bottom and broadcasts on Update.

## Architecture state

### Schema (migrations 044–059)
- Trip primitives: `book_by_date`, `responses_due_date` (auto-derived
  via trigger), `custom_intro_sms`, `trip_duration` (text)
- `nudge_sends` — cadence row table, drives the scheduler
- `poll_recommendations` — decision queue items
- `thread_messages.needs_planner_attention` + `delivery_status` (Twilio
  callbacks)
- `trip_session_participants.last_activity_at`
- Triggers: `trips_default_responses_due_date`,
  `trips_reseed_nudges_on_due_change`,
  `respondents_touch_participant_activity`
- 058: backfilled poll titles to "you/your" framing
- 059: backfilled duration polls to multi-select

### Edge functions (deployed)
- `sms-inbound` — Twilio webhook router
- `sms-broadcast` — planner fan-out
- `sms-join-submit` — web join form submit
- `sms-nudge-scheduler` — cron-driven SEED + FIRE; auto-generates
  recommendations once `responses_due` passes; runs every 15 min
- `sms-survey-confirmation` — post-submit SMS
- `sms-lock-broadcast` — splits responder/holdout on lock
- `sms-status-webhook` — Twilio delivery-status sync (operator step:
  set Status Callback URL in Twilio Messaging Service)

### Cron
- `sms-nudge-scheduler-every-15min` — pg_cron job. JWT lives in
  `vault.secrets` (migration 055).

### Tests
- 24 unit tests in `src/__tests__/cadence.test.ts`
  (`npx jest src/__tests__/cadence.test.ts`)
- 13 e2e integration tests in `scripts/run-cadence-verification.js`
  (`node scripts/run-cadence-verification.js`) — runs against prod with
  service-role key, cleans up after itself

### Manual e2e tooling (in `scripts/`)
- `launch-test-trip.js` — creates a fixture trip with planner +
  participant phones, optionally pokes scheduler so initial SMS fires
- `watch-trip.js` — colorized live tail of cadence/recs/inbox/SMS
  thread
- `poke-scheduler.js` — manual scheduler invocation
- `cleanup-test-trip.js` — wipes the fixture (or `--all`)

### Architecture doc
`docs/sms-cadence-architecture.md` — single-page lifecycle/cron/RPC
reference, security posture audit, known shortcomings.

## Test setup currently active

- iPhone has the EAS dev build installed (named "Rally" — replaces the
  older standalone build with the same `io.rallyapp.app` bundle ID).
- The dev client connects to Metro on the dev machine via
  `npx expo start --dev-client`.
- Web preview at `http://localhost:5173` serves a static export from
  `dist-preview/`. Most routes are auth-gated, but
  `/respond/[shareToken]`, `/results/[token]`, `/summary/[token]`, and
  `/join/[code]` work for public testing. After making React Router
  changes, re-run `npx expo export --platform web --output-dir dist-preview`
  to refresh.
- Active test trip: share_token `5e2c131b0b4ceacbaafa6002` (named
  "Test 3"). Has destination + duration + dates + budget polls all
  set up with the new framing + multi-select.

## Where the code currently is

### Trip creation (`app/(app)/trips/new.tsx`)
- ~750 lines. Field order: name → contacts → destination →
  trip length → trip dates → spend → book-by → intro SMS.
- Each field uses 0/1/2+ semantics; 2+ flagged with a green
  "Will be polled" badge.
- All form labels use a shared `FORM_LABEL_STYLE` /
  `FORM_HINT_STYLE` constant (system font, 14sp, 500 weight) so they
  match the StyleSheet-styled labels in `ContactSelector` /
  `IntroSmsEditor`. Don't replace these with NativeWind `font-medium`
  classes — that maps to Inter via tailwind.config.js and breaks
  visual parity.

### Trip edit (`app/(app)/trips/[id]/edit.tsx`)
- ~750 lines, mirrors `new.tsx` with state hydration + diff warnings
  + follow-up SMS.
- Hydration order: trip → polls → response counts.
- Diff snapshot captured once after hydrate (`initialSnapshot` state).
- Per-field reset warnings render inline below each field when
  `field changed && responseCounts[type] > 0`.
- Update flow: alert → confirm → updateTrip → rebuildPoll per changed
  field → broadcastToSession with the follow-up SMS.
- `ContactSelector` is **not** in this screen — participant management
  stays on the dashboard's `members.tsx` for now. This is a deliberate
  scope cut.

### Multi-day date picker (`src/components/MultiDatePicker.tsx`)
- Mode toggle (`SelectMode = 'day' | 'weekend' | 'week' | 'month'`).
- Helper exports: `groupConsecutiveDays`, `weekendDays`, `weekDays`,
  `monthDays`.
- `existingRanges` prop renders other ranges as a faded beige band so
  the planner can see context — used in the new-trip form to show
  ranges previously added.

### Survey form (`app/respond/[tripId].tsx`)
- 2000+ line file (was already big). Contains four poll renderers:
  `PollResponseCard`, `DatesPollCard`, `PollResultsCard`,
  `DateResultsCalendar`.
- `surveyPollTitle()` helper at line ~120 normalizes legacy poll
  titles to the new "you/your" framing on the survey side. Migration
  058 backfilled stored titles, but this override stays as a fallback
  for any pre-058 polls.
- `DatesPollCard` accepts an optional `tripDuration` prop and shows it
  as a banner above the calendar.

### Public pages
- `/respond/[shareToken]` — survey form (above)
- `/results/[token]` — public live results, polls 5s. Uses
  `<DateHeatmap>` for per-day dates polls. Decided polls without votes
  show "planner pick" instead of "No votes yet".
- `/summary/[token]` — locked decisions + "what's next" copy. Linked
  from the lock-broadcast SMS.
- `/join/[code]` — friend-invite form with SMS handshake.

## Known incomplete / deferred

- **Contacts editing in edit.tsx** — deliberately deferred; planner
  manages participants from the Group dashboard's roster instead.
  Could be added later if the dual-add/remove flow is desirable.
- **Follow-up SMS** broadcasts to the WHOLE session, not just
  respondents. There's no separate edge function for "respondents
  only" yet. Acceptable for v1 but worth a note.
- **Realtime subscriptions** for dashboard cards — currently 60s
  polling. The right Phase-2 upgrade.
- **Token rotation** on `share_token` — never rotated. Anyone with a
  leaked token can read/respond.
- **Service-role JWT in cron** — moved to `vault.secrets` (055), but
  it's still seeded from a migration that contains the JWT in source.
  Acceptable since the JWT is already in source (migration 029, 046),
  but worth a vault-only seed pattern long-term.
- **Push notifs** — wired for inbound replies and recommendation
  ready. Not yet for synthesis milestones, lock-broadcasts (planner
  side), or "responses-due tomorrow".

## What likely comes next

Possible directions, prioritized as I'd sequence them:

1. **Test the new edit flow on the actively-used Test 3 trip.** Tap
   the trip hero, see the form pre-filled, change a destination,
   notice the warning, confirm the alert, watch the broadcast SMS
   arrive. This is the highest-leverage validation.
2. **Add contacts editing to edit.tsx** if the dashboard-side flow
   feels disconnected from "edit the trip" mental model. Mirrors
   `ContactSelector` with hydration from `trip_session_participants`.
3. **Onboarding polish** — the first-trip onboarding modal exists but
   could be richer (or moved to in-form for clearer affordances).
4. **Edit-poll-options-only (without trip changes)** — the polls
   screen exists but doesn't expose the new option-builder UX. Bringing
   the same option-list UX there would make the polls screen feel
   consistent with trip creation.
5. **Push-notif coverage** for the planner-side moments we're missing
   (recommendation approved, follow-up confirmed, etc.).
6. **Realtime subscriptions** to replace the 60s polling on the
   dashboard cards.

## How to pick up

Read in this order:
1. This file
2. `docs/sms-cadence-architecture.md`
3. `app/(app)/trips/new.tsx` (lines 1–250 for state, 250+ for JSX)
4. `app/(app)/trips/[id]/edit.tsx` (mirrors new with hydration +
   diff warnings)
5. `src/components/MultiDatePicker.tsx` (date picker + mode toggle)
6. `src/components/trips/ContactSelector.tsx` (native picker pattern)
7. `app/respond/[tripId].tsx` lines 100–500 (poll rendering on the
   survey side)

Then ask the user what specifically they want to work on. Don't
batch-improve — they prefer specific, testable changes.

## A few sharp edges

- `useEffect` with `[durationNumber, durationUnit]` auto-commits the
  duration combo. Don't introduce another effect that resets either
  selector — it'll fight this one.
- The trip's primitive fields (`destination`, `start_date`, `end_date`,
  `budget_per_person`, `trip_duration`) are only set when there's
  exactly **one** option for that field. 0 or 2+ options = nullified.
  This is the contract that lets `syncTripFieldsToPolls` create
  decided polls automatically.
- `parseDateRangeLabel` (`src/lib/pollFormUtils.ts`) silently rolls
  the year forward if the parsed date is in the past. Works for
  near-term planning but breaks at year boundaries — be careful when
  parsing labels for trips planned > 1 year out.
- The web preview is a STATIC export. Re-run
  `npx expo export --platform web --output-dir dist-preview`
  after any new `app/**/*.tsx` route file is added (otherwise the
  route shows "Unmatched Route").
- iOS Developer Mode must be enabled for the EAS dev build to launch
  on a real device (Settings → Privacy & Security → Developer Mode).
