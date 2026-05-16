# Rally — Phase C Build Guide

> **For: Claude Code**
> **Source of truth for product decisions:** `rally_v1_scope.md`
> **Prerequisite:** Phase B is complete, signed off on localhost, and deployed for alpha testing
> **Scope of this guide:** Phase C only — full outbound SMS coverage and re-engagement. Mobile app code (Expo) is NOT touched.

---

## What this guide is

Phase C completes v1 by making sure every key moment in the trip lifecycle has a corresponding outbound SMS nudge that pulls people back to web at the right time. It also gives planners and cohosts a manual blast composer for high-stakes pushes.

The SMS agent is still outbound-only in v1. No inbound parsing. No two-way conversation. That's parked until monetization (v2).

Same working agreement and question-surfacing protocol as Phases A and B. Re-read those sections of the prior guides if needed.

---

## Phase 0 — Learn from Phase B (MANDATORY)

Before any Phase C work:

1. **Read `PHASE_B_DEMO.md`.** Understand what was built.
2. **Read `PHASE_B_PRE_BUILD_REVIEW.md` and the Phase B `BUILD_QUESTIONS.md`.** Note what decisions shaped the dashboard.
3. **Re-run schema inspection** — capture the post-Phase-B state of the schema. Save to `SCHEMA_REPORT.md`.
4. **Read the codebase** for anything that drifted from the guides.
5. **Read the Phase A `sms_messages` table data** if it exists in the alpha environment. Look at:
   - What types of nudges have already fired
   - Delivery rates
   - Any patterns of failure
   - User-reported feedback on SMS tone or timing (in `PHASE_B_DEMO.md` notes or alpha tester comments)
6. **Reconcile this guide with Phase B reality.** For each section below:
   - Does the SMS trigger logic match the data the dashboard now produces?
   - Are there blast scenarios that Phase B users have been asking for that aren't in this guide?
   - Did the Phase A RSVP nudge work? If not, what needs to change in how nudges are timed or worded?
7. **Write `PHASE_C_PRE_BUILD_REVIEW.md`** with:
   - What you learned from Phases A and B
   - Conflicts surfaced between this guide and reality
   - Recommendations for resolving each
   - Specifically: any new SMS message types or trigger conditions that should be added based on Phase B behavior
8. **STOP. Wait for human review of `PHASE_C_PRE_BUILD_REVIEW.md` before proceeding.**

---

## 1. Step 0 — Schema inspection (still mandatory)

Same as Phases A and B. Run before any backend work in Phase C. Save to `SCHEMA_REPORT.md` and `SCHEMA_PLAN.md`. Additive only.

---

## 2. Phase C build order

1. **Schema additions** for blasts and reminder scheduling
2. **Auto Reminders — full set** (extend Phase A's `rsvp_nudge` with the rest)
3. **Planner Blast composer** in the dashboard
4. **Blast send pipeline** with rate limits and carrier-compliance guardrails
5. **Blast → activity feed auto-post**
6. **Cohost permissions** for blasts and reminder config
7. **Re-engagement triggers** for stalled trips
8. **Cancel Trip flow** (deferred from Phase A — needs blast infra to notify everyone cleanly)

---

## 3. Phase C schema additions

All additive. Reconcile against current state in Step 0.

**`sms_messages`** (already exists from Phase A) — extend message_type enum:
- Add: `lodging_vote_open`, `lodging_locked`, `itinerary_vote_open`, `final_headcount`, `cancellation_notice`, `re_engagement`
- Do NOT remove existing enum values

**`scheduled_reminders`** — for time-based auto reminders that need to fire in the future
- `id` uuid PK
- `trip_id` uuid references `trips.id`
- `recipient_membership_id` uuid references `trip_memberships.id`
- `message_type` (matches sms_messages enum)
- `scheduled_for` timestamp
- `status` enum: `pending`, `sent`, `cancelled`, `skipped`
- `sent_sms_message_id` uuid references `sms_messages.id` nullable
- `created_at`, `updated_at`

**`planner_blasts`** — composed blast records
- `id` uuid PK
- `trip_id` uuid references `trips.id`
- `composed_by` uuid references `users.id`
- `recipient_segment` enum: `going`, `maybe`, `invited`, `all`
- `message_body` text
- `sent_at` timestamp
- `recipient_count` integer
- `auto_posted_to_feed` boolean default true
- `activity_feed_entry_id` uuid references `activity_feed_entries.id` nullable
- `created_at`

**`planner_blast_sends`** — one row per recipient per blast (for tracking delivery)
- `id` uuid PK
- `blast_id` uuid references `planner_blasts.id`
- `recipient_membership_id` uuid references `trip_memberships.id`
- `sms_message_id` uuid references `sms_messages.id`

**`trip_reminder_settings`** — per-trip config for which auto reminders are on
- `trip_id` uuid PK references `trips.id`
- `rsvp_nudge_enabled` boolean default true
- `profile_completion_enabled` boolean default true
- `booking_nudge_enabled` boolean default true
- `pre_trip_summary_enabled` boolean default true
- `re_engagement_enabled` boolean default true
- Other type-specific settings (timing offsets, etc.) as needed

### Phase C indexes
- `scheduled_reminders`: `(scheduled_for, status)` for the cron worker
- `planner_blasts`: `(trip_id, sent_at desc)`
- `planner_blast_sends`: `(blast_id)`, `(recipient_membership_id)`

---

## 4. Auto Reminders — full set

Phase A shipped `rsvp_nudge`. Phase C extends with the rest. Each reminder type:

1. **`rsvp_nudge`** (already shipped, verify still working) — to `invited` and `maybe`, 3 days post-invitation if not yet `going`. Repeat once 7 days later if still no response. Then stop.

2. **`profile_completion_nudge`** — only for the edge case where someone bypassed the required-at-first-RSVP profile (e.g. an existing user with a stale profile who hit "edit later" on the confirmation flow). Fires 24 hours after RSVP if profile fields critical to AI generation (vibes, home airport) are missing. Single send, no repeat.

3. **`booking_nudge`** — to `going` members without a `travel_arrangement` record (no flight or drive entered) OR without an assigned room in `lodging_room_assignments`. Fires 14 days before trip start. Repeats at 7 days. Stops at 3 days out (too late to book at that point — pre-trip summary takes over).

4. **`pre_trip_summary`** — to `going` members 3 days before trip start. Personalized: "Here's where you stand — [room assigned ✓ or ✗], [flight ✓ or ✗], [outstanding payment if any], [first activity]". Single send.

5. **`re_engagement`** — to `going` members of trips that have stalled (no activity feed entries for 14+ days, planning still incomplete by some signal — no lodging selected, or no itinerary generated). Fires once. Designed to nudge planners back into action via a "your trip needs love" message to the planner specifically.

### Scheduling
- Reminders are scheduled into `scheduled_reminders` at the moment the triggering condition becomes possible (e.g. on RSVP, schedule the `pre_trip_summary` for `trip.start_date - 3 days`)
- A cron worker runs every N minutes, picks up `pending` reminders where `scheduled_for <= now()`, checks if the triggering condition is still valid (e.g. user is still `going` and hasn't completed the relevant action), sends if valid, marks `sent` or `skipped`
- Cancellation: if the triggering condition resolves (user RSVPs, books a flight), set the corresponding `scheduled_reminder` to `cancelled`

### Voice and timing
- Voice principles from the scope doc apply to every type
- Each message ends with a CTA link to the relevant web surface
- All sends recorded in `sms_messages` with `message_type` matching the reminder type
- Never send more than 2 SMS to the same person in a 24-hour window across all types (auto reminders + blasts) — global rate limit

---

## 5. Planner Blast composer

### UI
- Lives in the trip dashboard (host/cohost only)
- "Send Blast" button in a clear location (consider the More menu OR a top-right action button per Phase B's design)
- Composer modal:
  - Recipient segment selector: Going / Maybe / Invited / All (recipient count shown live)
  - Message body textarea (character limit visible — match SMS practical limits, ~480 chars to leave headroom for personalization)
  - Preview pane showing what one recipient will see (with their name substituted)
  - "Send to N people" button
  - Confirmation step before send: "This will send N SMS messages and post to the activity feed. Continue?"

### Send pipeline
- Creates a `planner_blasts` row
- Creates a `planner_blast_sends` row per recipient
- For each recipient, sends an individual SMS via Twilio (1:1, not group MMS)
- Auto-posts to `activity_feed_entries` with a `planner_post` entry type, content includes the blast body
- Updates `planner_blast.activity_feed_entry_id`
- Tracks delivery status per recipient

### Rate limits
- **3 blasts per week per trip** (rolling 7-day window). Enforce in the API layer.
- **10 blasts per trip lifecycle.** Enforce in the API layer.
- Both limits surface clearly to the host BEFORE they hit send ("You have 2 of 3 weekly blasts remaining")
- Global per-person 24-hour limit applies (no more than 2 SMS per recipient per day across all sources)

### Carrier compliance
- Every blast SMS body must include some form of trip identification (trip name in the message, or implicit via the included link)
- Include opt-out language periodically — at minimum on the first blast a user receives from any trip ("Reply STOP to opt out of Rally messages"). Track opt-outs in a user-level field; opted-out users never receive any SMS again.
- Do not send between 9pm and 9am in recipient's local time zone (use `home_airport` as a proxy for time zone, or fall back to phone area code). Schedule into the next morning instead.

---

## 6. Cohost permissions

- Cohosts get full parity with the host for:
  - Composing and sending blasts
  - Configuring `trip_reminder_settings`
  - Cancelling/skipping scheduled reminders
- This requires verifying the cohost relationship via `trip_cohosts` in every relevant API endpoint
- Existing host-only checks in Phase A and B should be audited and broadened to "host or cohost" where appropriate (this is part of Phase 0 reconciliation — surface as a conflict if Phase B has host-only checks that need to expand)

---

## 7. Re-engagement for stalled trips

Beyond the `re_engagement` reminder type above, the system should detect stalls and surface them in two ways:

1. **To the planner via SMS** — single re-engagement message as described in Section 4
2. **To the planner via the dashboard** — a banner on the trip page ("Your trip has been quiet — want to send a blast?") with a one-tap shortcut to the blast composer with a pre-filled suggested message

### Stall detection signals (any one triggers)
- No activity feed entries in 14+ days AND trip start date is more than 21 days away
- More than 50% of `going` members have no lodging assignment AND trip start date is less than 30 days away
- No itinerary items generated AND trip start date is less than 21 days away

---

## 8. Cancel Trip flow

Deferred from Phase A intentionally — depends on blast infra.

- "Cancel Trip" in the host controls More menu (already shown in the Phase A UI, but action was disabled)
- Confirmation modal: "This will cancel the trip and notify all guests via SMS and the activity feed. This action cannot be undone."
- On confirm:
  - Update `trips` with a `cancelled_at` timestamp (additive column — add in Phase C schema migration)
  - Cancel all `scheduled_reminders` for the trip
  - Send a `cancellation_notice` SMS to every member (Going, Maybe, Invited)
  - Auto-post to activity feed
  - Lock the trip page in a "Cancelled" state — feed visible but no new RSVPs or activity allowed

Add `cancelled_at` column to `trips` table as part of Phase C schema migration.

---

## 9. Phase C definition of done

**Every key moment in the trip lifecycle has a corresponding SMS nudge.**

- [ ] All Auto Reminder types implemented and tested (rsvp_nudge, profile_completion_nudge, booking_nudge, pre_trip_summary, re_engagement)
- [ ] Scheduled reminder worker runs reliably and respects cancellation conditions
- [ ] Planner Blast composer exists in the dashboard
- [ ] Recipient segment selector and preview work correctly
- [ ] Blast send creates per-recipient SMS records and auto-posts to activity feed
- [ ] Rate limits enforced: 3/week per trip, 10/trip lifecycle, 2/24h per recipient
- [ ] Quiet hours respected (9pm–9am recipient local time)
- [ ] STOP/opt-out keyword handling implemented at the platform level
- [ ] Cohost permissions parity with host for all blast and reminder controls
- [ ] Re-engagement banner appears on stalled trips with one-tap blast shortcut
- [ ] Cancel Trip flow works end-to-end with SMS + feed notification
- [ ] All schema additions additive
- [ ] Mobile-first responsive — works in phone viewport
- [ ] `BUILD_QUESTIONS.md` empty or all RESOLVED
- [ ] `PHASE_C_PRE_BUILD_REVIEW.md` filed and reviewed before build started
- [ ] `PHASE_C_DEMO.md` written for localhost handoff
- [ ] Test plan exercises drawn from the 95-case edge case catalog covering outbound voice/timing — all passing

**What's explicitly NOT in Phase C:**
- [ ] Two-way / inbound SMS (parked until v2 monetization)
- [ ] Inbound parsing or NLU (parked until v2)
- [ ] Integrated booking (v2)
- [ ] Native general cost splitting (v2)
- [ ] On-trip mode (v2)
- [ ] Post-trip recap (v2)
- [ ] Mobile app (v3)
- [ ] Anything in Future State v3

---

## 10. v1 alpha launch readiness

After Phase C definition of done is met, Rally v1 is feature-complete for alpha.

Run a full end-to-end scenario covering all three phases:
1. Planner creates trip
2. Invites 5 friends — mix of new and existing Rally users
3. New users complete profile capture; returning users one-tap confirm
4. Friends RSVP, post to feed
5. Profile aggregation engine produces aggregate
6. Planner generates itinerary, picks lodging, assigns rooms, generates meal plan
7. Group votes on AI-generated items
8. Shopping list auto-builds from meals
9. Generate Flyer, share to a test channel
10. Travel arrangements entered, flight suggestions surfaced
11. Stalled-trip detection triggers re-engagement
12. Planner sends a blast — confirms rate limit math, feed auto-post, SMS delivery
13. Pre-trip summary fires 3 days out
14. (Optional) Cancel a different test trip to validate cancellation flow

Write `V1_ALPHA_READY.md` covering:
- All three demo docs referenced
- Known issues / rough edges across the full v1
- Resolved questions across all three `BUILD_QUESTIONS.md` files
- A clear "ready to push to production for alpha" recommendation OR a list of blockers

**STOP. Wait for human sign-off before any production push.**
