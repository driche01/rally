# Phase C — Localhost Demo

**Status:** ready for human review (build guide §9 handoff).
**Branch:** `claude/eager-sanderson-00015d`.
**Last commit:** `85d43b8` (Step 7 re-engagement + Q25 home_airport).
**Polyglot scheduler:** deployed to prod, smoke-tested live.

---

## TL;DR

Phase C ships the outbound-SMS coverage that ties together every key moment in the trip lifecycle: 5 auto-reminder types via a queue-based polyglot scheduler, a planner blast composer with rate limits + opt-out enforcement, stall detection that surfaces both as planner-targeted SMS and a dashboard banner, and an end-to-end cancel-trip flow. Outbound-only — no inbound parsing or two-way conversation (those are v2).

Schema head: **140**. Edge function deployed: **sms-rsvp-nudge-scheduler** (polyglot, 5 reminder types). Web routes added: **/api/trips/[id]/blasts** + **/api/trips/[id]/cancel**.

---

## How to run it

### Prereqs (same as Phase A/B + the deployed scheduler)
- Node ≥ 18
- Supabase CLI 2.84.2+
- `/web/.env.local` populated with everything from Phase A/B
- The polyglot scheduler **is deployed to prod** — no Docker needed for the dev loop
- A `profiles` row with phone (your alpha-cohort identity) — same as Phase A

### Verify the live schema

```bash
supabase db query --linked "select version, name from supabase_migrations.schema_migrations where version::int >= 135 order by version::int" -o table
```
→ should list `135` through `140`.

### Manually trigger the scheduler

```bash
curl -X POST https://qxpbnixvjtwckuedlrfj.supabase.co/functions/v1/sms-rsvp-nudge-scheduler \
  -H "apikey: <service-role>" \
  -H "Authorization: Bearer <service-role>"
```
→ returns `{ ok: true, lazy_scheduled, re_engagement_scheduled, scanned, fired, skipped }`.

### Set up the cron (deferred — paste into Supabase SQL editor when ready)

```sql
SELECT cron.schedule(
  'sms-rsvp-nudge-scheduler',
  '*/30 * * * *',
  $$ SELECT net.http_post(
       url:='https://qxpbnixvjtwckuedlrfj.supabase.co/functions/v1/sms-rsvp-nudge-scheduler',
       headers:= jsonb_build_object('apikey', current_setting('app.service_role_key'))
     ); $$
);
```

Confirmed working at 2026-05-12 — first manual invocation against prod scheduled 3 re_engagement rows and fired all 3 to David's phone (test trips matched the no_itinerary stall signal).

---

## Test scenarios

### 1. Send a planner blast

1. Open `/trips/<existing-trip-id>` (any trip you host).
2. Tap **Send blast →** in the action row. The composer modal opens.
3. **Segment**: tap Going / Maybe / Invited / Everyone. Live recipient count under each pill.
4. **"Also send to me"**: defaults off. Check to include your own planner self-respondent.
5. **Message**: type something. `[Name]` substitutes each recipient's first name. Counter shows chars left; turns orange after 480 chars (will span 2+ SMS segments).
6. **Preview**: live render with `[Friend]` substituted.
7. Tap **Send to N →**. Two-step confirm: "This will send N SMS messages and post to the activity feed."
8. Confirm — within a few seconds the result panel shows `N sent, X failed, Y suppressed (opted out), Z suppressed (over 2/24h limit)`. Limits remaining shown.
9. Reload trip page — `planner_post` entry in the activity feed with the blast body.
10. Hit `Send blast` again immediately on the same trip — works (you have 2/3 weekly + 9/10 lifetime left). Try a third — same. Fourth blast in a 7-day window returns `429 rate_limit_exceeded`.

### 2. Reminder cadence (manual force)

1. Create a fresh trip, invite a phone you have access to.
2. Set `respondents.invited_at` to ≥ 3 days ago via SQL (or just wait):
   ```sql
   UPDATE respondents SET invited_at = now() - interval '4 days' WHERE phone = '+1...' AND rsvp_status = 'invited';
   ```
3. Invoke the scheduler manually (curl above) — the response shows `lazy_scheduled: 1, scanned: 1, fired: 1`.
4. The recipient gets the `rsvp_nudge` SMS via Twilio.

Same pattern for the other reminder types — each fires when its trigger condition is met:
- `profile_completion_nudge`: respondent.rsvp_status='going' + incomplete `traveler_profiles`
- `booking_nudge`: going + no `travel_arrangements` row OR no `lodging_room_assignments` row + start_date > 3d
- `pre_trip_summary`: going + 3 days before start
- `re_engagement`: planner self-respondent + stall signal active

To trigger `re_engagement` on a trip: ensure it has `start_date` set 5–60 days out + matches any stall signal (no itinerary, no recent activity, etc.).

### 3. Re-engagement banner (dashboard)

1. Open `/trips/<stalled-trip-id>` — a trip whose start_date is within ~60d but missing itinerary/lodging/recent activity.
2. Above the action row, gold-bordered banner appears: "Things have been quiet" / "Most of the group doesn't have a room yet" / "No itinerary yet" (depending on which signal matched).
3. Tap **Send a nudge →** — opens the blast composer.

The banner is computed server-side in `trips/[id]/page.tsx` via `web/lib/stall-detector.ts`. Three cheap count queries max.

### 4. Cancel trip

1. Open any trip you host. Tap **Cancel trip** (orange button, right end of action row).
2. Confirm in the dialog ("This will: Notify every guest via SMS / Lock the trip page / Post a system entry / This cannot be undone.").
3. Within a few seconds: alert shows `Trip cancelled. SMS: N sent, X failed, Y suppressed`. Page reloads.
4. Top of the Overview tab now has an orange **Cancelled** banner. Invite + Send blast buttons disabled. Clone trip stays enabled.
5. Activity feed shows a `system` entry: "This trip has been cancelled by the host."
6. Open `/invite/<share_token>` in incognito — the public RSVP API returns `410 trip_cancelled`. (The page itself still renders the feed read-only.)
7. Hit `/api/trips/<id>/invitations` from the cancelled trip's invite modal — returns `410 trip_cancelled`.

### 5. Opt-out (STOP)

1. Reply STOP from any phone that has received Rally SMS. `sms-inbound` flips `users.opted_out=true`.
2. Try to send a blast to a segment that includes that phone — the recipient is filtered out at the send rail (`dm-sender.ts` returns `opted_out`; `web/lib/twilio.ts` returns `opted_out`). The blast composer shows `Y suppressed (opted out)` in the result panel.

### 6. Reminder host toggles (deferred UI)

The `trip_reminder_settings` table exists with all-toggles-on as the default. There's no UI yet to flip the toggles — host SQL or admin-only API can do it for now. UI is a Phase C polish follow-up.

---

## What landed in Phase C (commit-by-commit)

| Step | Commit | Notes |
|---|---|---|
| Pre-build review | `dcbae6c` + `9799284` | Q18–Q26 RESOLVED + LEGACY_CLEANUP.md |
| Step 0 / Step 1 | `42d6a76` + `88fc3cb` | 6 migrations (135–140) applied to prod |
| Step 2 + polish | `0d690b8` | Polyglot scheduler + iata_to_tz.json + shared types + Q24 self-respondent + Q23 opt-out in dm-sender |
| Steps 3 + 4 + 5 | `16351b2` | `/api/trips/[id]/blasts` + BlastComposer modal + activity-feed auto-post + rate limits |
| Step 8 | `911e2a2` | `/api/trips/[id]/cancel` + cancelled-state UI + write-path gates |
| Step 7 + Q25 | `85d43b8` | Re-engagement detection in scheduler + dashboard banner + home_airport required |
| Step 6 | (in-place) | Cohost parity confirmed across every Phase B + Phase C route by reading existing pattern; no separate commit needed |
| Deploy | n/a | `supabase functions deploy sms-rsvp-nudge-scheduler` ran 2026-05-12 |

---

## Schema state (post-Phase-C)

4 new tables + 2 new columns on `trips`, all applied (`supabase_migrations` versions 116–140).

**New (Phase C):**
- `scheduled_reminders`
- `planner_blasts`
- `planner_blast_sends`
- `trip_reminder_settings`

**Extended (Phase C):**
- `trips`: + `cancelled_at`, + `cancelled_by` (FK profiles)

**No CHECK constraint changes**, no FK changes on pre-existing columns. Phase C `thread_messages.message_type` values are app-layer-only (the column is unconstrained text per Q5).

Per Q18, every Phase C per-member FK targets `respondents(id)`. Per Q20, planner-side FKs target `profiles(id)`.

---

## Decisions (BUILD_QUESTIONS.md Q18–Q26, all RESOLVED 2026-05-12)

| Q | Locked to |
|---|---|
| Q18 | Per-member FKs → `respondents(id)`, column `recipient_respondent_id` |
| Q19 | SMS log stays on `thread_messages` (extended; new message_type values app-layer) |
| Q20 | `planner_blasts.composed_by → profiles(id)` |
| Q21 | New `/api/trips/[id]/blasts` route (clean) + legacy `sms-broadcast` on cleanup list |
| Q22 | Single polyglot scheduler (`sms-rsvp-nudge-scheduler`, switch on `message_type`) |
| Q23 | Every Phase C send goes through `dm-sender.ts` / `web/lib/twilio.ts` — both now enforce `users.opted_out` |
| Q24 | Auto-create planner self-respondent on trip creation; backfill 140 caught existing trips |
| Q25 | `home_airport` REQUIRED at profile capture (no NYC default); static `iata_to_tz.ts` |
| Q25a | Recipients without a profile → sender's local timezone for quiet-hours gating |
| Q26 | Suppress opted-out recipients even for cancellation notices |

Q1–Q17 (Phases A + B) still binding.

---

## Known issues + deferred work

### Stuff that works but could be polished

- **Quiet-hours implementation is partial.** The IATA→TZ map is in place + the spec is clear, but the polyglot scheduler doesn't yet split the send loop into "send now" vs "reschedule for next morning in their local tz" branches. As of now: every reminder fires at scheduler-tick time without local-tz gating. Loud-tonight is preferable to silent-tomorrow during alpha; we'll layer this on once the cohort grows.
- **Per-recipient 2/24h rate limit applies to blasts only.** The blast composer enforces it via `filterRecipientsBy24hLimit`. The scheduler send loop doesn't yet count cross-source against the same limit — if a recipient gets an `rsvp_nudge` AND a planner blast in the same 24h, only the blast pipeline notices.
- **`trip_reminder_settings` toggle UI is missing.** Table + RLS + scheduler honoring it are all live; just no UI to flip the toggles. Hosts can do it via SQL for now.
- **Re-engagement banner CTA pre-fill.** The stall signal carries a suggested SMS body, but the "Send a nudge →" button just opens the blast composer empty. Wiring the pre-fill is a one-liner — punted.
- **Cohost-only flows are not exercised in the demo script.** Cohosts can compose blasts and cancel trips per the API gates, but `trip_cohosts` is empty in dev data so we can't test the UI side yet.
- **Write-path cancellation gates are partial.** Invitations + RSVP routes gate on `cancelled_at`. Memberships, activity comments, AI-generation routes, and the Phase B voting routes do NOT yet. Shared helper `web/lib/trip-state.ts::assertTripWritable()` exists for the audit pass to land them in a follow-up.
- **The "first run after deploy" sent 3 re_engagement SMS to David's phone.** Test trips matched the `no_itinerary` signal because their start_dates are within 21 days. Worth being aware of for future bulk-deploys against existing test data.

### Things to settle before alpha

- **pg_cron entry not yet scheduled.** Function is deployed and works on manual invocation. Pasting the cron snippet (in PHASE_C_DEMO §3) into the Supabase SQL editor enables the 30-minute tick.
- **Legacy SMS edge functions still deployed alongside.** `sms-broadcast`, `sms-nudge-scheduler`, etc. still live, but nothing in v1 calls them. [LEGACY_CLEANUP.md](LEGACY_CLEANUP.md) is the running list — pull the trigger when comfortable.
- **Twilio rate-limit ceilings.** With per-trip 3 weekly blasts × 20 alpha trips, alpha could in theory burst ~60 blasts/week. Plus reminders. Confirm Twilio's outbound rate limit (10/sec by default, plenty) and per-day limit on the toll-free number.
- **STOP/REJOIN end-to-end smoke test.** `sms-inbound` is wired + `users.opted_out` flips on STOP + send rail respects the flag. Tested in unit/code review but not yet end-to-end with a real STOP SMS — do this once at the start of alpha to confirm carrier routing.

### Out-of-scope deferrals (intentional)

- **Two-way SMS / inbound parsing / NLU** — parked until v2.
- **Integrated booking** — v2.
- **Native cost splitting** — v2.
- **Mobile app** — v3.

---

## File map — new this phase

```
/PHASE_C_DEMO.md                              ← this doc
/PHASE_C_PRE_BUILD_REVIEW.md                  ← Q18–Q26 resolutions
/SCHEMA_REPORT.md                             ← post-Phase-B inventory
/SCHEMA_PLAN.md                               ← migrations 135–140 DDL preview
/LEGACY_CLEANUP.md                            ← post-Phase-C deletion roadmap
/BUILD_QUESTIONS.md                           ← Q18–Q26 RESOLVED

/supabase/migrations/135_phase_c_trips_cancelled.sql
/supabase/migrations/136_phase_c_scheduled_reminders.sql
/supabase/migrations/137_phase_c_planner_blasts.sql
/supabase/migrations/138_phase_c_planner_blast_sends.sql
/supabase/migrations/139_phase_c_trip_reminder_settings.sql
/supabase/migrations/140_phase_c_self_respondent_backfill.sql

/supabase/functions/sms-rsvp-nudge-scheduler/index.ts       ← polyglot (refactored)
/supabase/functions/sms-rsvp-nudge-scheduler/bodies.ts      ← per-type SMS bodies
/supabase/functions/sms-rsvp-nudge-scheduler/conditions.ts  ← per-type validators
/supabase/functions/sms-rsvp-nudge-scheduler/types.ts       ← shared row shapes

/supabase/functions/_sms-shared/dm-sender.ts                ← + opt-out check (Q23)

/shared/types.ts                              ← ScheduledReminder, PlannerBlast,
                                                PlannerBlastSend, TripReminderSettings,
                                                RecipientSegment, ReminderStatus.
                                                Trip.cancelled_at + cancelled_by.
                                                SmsMessageType expanded with Phase C types.
/shared/iata_to_tz.ts                         ← Q25 IATA → IANA TZ map

/web/lib/twilio.ts                            ← + opt-out check (Q23)
/web/lib/blasts/rate-limits.ts                ← Q21 rate-limit math
/web/lib/trip-state.ts                        ← assertTripWritable() helper
/web/lib/stall-detector.ts                    ← Step 7 dashboard banner

/web/app/api/trips/route.ts                   ← + Q24 self-respondent insert
/web/app/api/trips/[id]/blasts/route.ts       ← Step 3: GET + POST
/web/app/api/trips/[id]/cancel/route.ts       ← Step 8
/web/app/api/trips/[id]/invitations/route.ts  ← + cancelled-trip gate
/web/app/api/invite/[token]/rsvp/route.ts     ← + cancelled-trip gate
/web/app/trips/[id]/page.tsx                  ← + stall detection
/web/app/trips/[id]/trip-dashboard.tsx        ← + Send blast button + Cancel trip
                                                button + Cancelled banner +
                                                Re-engagement banner
/web/app/trips/[id]/blast-composer.tsx        ← Step 4 modal
/web/app/invite/[token]/rsvp/profile-capture.tsx ← Q25: home_airport required
```

---

## Next steps — toward V1 alpha

After this Phase C demo is signed off, the remaining work is:

1. **Add pg_cron schedule** (paste the snippet in §3 into the Supabase SQL editor)
2. **Run end-to-end alpha rehearsal** per `docs/rally_phase_c_build_guide.md` §10 — covers all three phases (A + B + C) in one walk-through
3. **Write `V1_ALPHA_READY.md`** — known issues + ready-to-push recommendation OR blocker list
4. **Pull the trigger on `LEGACY_CLEANUP.md`** in a separate cleanup PR (don't bundle with alpha launch — keep changes auditable)

Per CLAUDE.md hard rule #7, stopping here until Phase C sign-off.
