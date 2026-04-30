# Manual E2E Test Plan

Six scenarios that exercise the survey-based 1:1 SMS pivot end-to-end.
Each one sets up a real trip in production, fires real SMS to real
phones, and walks the planner through the dashboard surfaces. Plan ~45
min for the full pass; ~10 min per scenario after the first.

## Before you start — what you need

- **Two phone numbers** that can receive SMS (US numbers, real). One
  plays planner, one plays participant. Three numbers gives you a
  "majority + holdout" scenario; two is the minimum.
- **The Rally app** installed on the planner's phone (Expo Go is fine)
  OR a logged-in browser session at the planner's email.
- **Terminal access** to this repo, with `node` available.
- **One unused 5-min window** of attention per scenario — Twilio takes
  3-10 sec to deliver each SMS, so don't run scenarios in parallel.

The scripts use the production Supabase project + Twilio TFN
`+16624283059`. Real SMS will be sent. Cost is ~$0.005/message — expect
to spend under $0.50 across the full pass.

## The four scripts

| Script | What it does |
| --- | --- |
| `node scripts/launch-test-trip.js` | Creates a trip + session + participants. Optionally pokes the scheduler so the initial SMS fires within seconds. |
| `node scripts/watch-trip.js` | Live tail (5s refresh) of nudges, recommendations, inbox, and SMS thread for the current test trip. Run this in a second terminal. |
| `node scripts/poke-scheduler.js` | Manually invoke the scheduler. Use between scenarios to skip the 15-min cron wait. |
| `node scripts/cleanup-test-trip.js` | Delete the current test trip (or `--all` to wipe every `__e2e__` fixture). |

State is persisted in `.test-trip.json` (gitignored — add to .gitignore
if you want). Most scripts read from there automatically.

---

## Scenario 1 — Happy path

**Goal**: Planner creates trip → invites two friends → both respond →
recommendation auto-generates → planner approves → both get the lock SMS.

### Setup

```bash
node scripts/launch-test-trip.js \
  --planner-phone +1YOURPHONE \
  --participant +1FRIEND1 \
  --participant +1FRIEND2 \
  --book-by-days 5 \
  --destination "Cancun" \
  --name "__e2e__ Scenario 1"
```

In a second terminal:

```bash
node scripts/watch-trip.js
```

### What to watch for

1. **Within ~10 sec**: Both participant phones receive the initial SMS:
   *"Hey Test 1 — [Planner] is planning a trip to Cancun and wants your input. Quick survey (no login): https://..."*
2. The watch script's NUDGES section should show 2 `initial · sent`
   rows, plus 8 pending rows for the d1/d3/rd-2/rd-1 schedule.
3. Open the survey link on participant 1's phone. RSVP "I'm in", set
   preferences, submit. Confirmation SMS should arrive ~5 sec later.
4. The watch script's PARTICIPANTS section should show participant 1 as
   `responded` and `last_activity: <Xs ago>`.
5. Repeat for participant 2.
6. **Add a poll**: in the planner app, navigate to the trip's polls
   screen, create a destination poll with 2-3 options. Mark it `live`.
7. Vote on each participant's phone (re-tap survey link → polls section).
8. **Trigger the recommendation**: in the planner app's polls screen,
   tap "Get Rally's pick" on the live poll. Within ~3 sec, the
   dashboard's "Pending decisions" card should show the recommendation
   with vote breakdown + confidence pill.
9. Tap "Approve" on the recommendation. Within ~10 sec, both
   participants should receive: *"Locked in: [option] for the
   destination. See the full plan: https://..."*
10. Tap the link on a participant's phone — should land on the
    `/summary/[token]` page showing the locked decision.

### Expected dashboard end-state

- DecisionQueueCard shows the recommendation in the "Just locked · undo
  within 5 min" section with a countdown.
- AggregateResultsCard shows the destination poll as "Locked".
- CadenceCard shows `0 upcoming` (or just the d1/d3 if book-by is more
  than 4 days out).

### Cleanup

```bash
node scripts/cleanup-test-trip.js
```

---

## Scenario 2 — Book-by date changes mid-flight

**Goal**: Planner edits book-by → cadence reseeds, dashboard reflects
the new schedule.

### Setup

Same as Scenario 1 but with `--book-by-days 30` and `--no-poke`. The
larger window means heartbeat nudges should appear in the cadence.

```bash
node scripts/launch-test-trip.js \
  --planner-phone +1YOURPHONE \
  --participant +1FRIEND1 \
  --book-by-days 30 \
  --no-poke \
  --name "__e2e__ Scenario 2"

node scripts/poke-scheduler.js   # seed the cadence
```

### What to do

1. Watch script: confirm cadence rows include 1+ `heartbeat` entries.
2. In the planner app's edit-trip screen, change book-by to 90 days out.
   Save.
3. Watch script: within 5 sec, confirm pending nudges flip to
   `skipped (book_by_changed)`. The reseed-on-change trigger fires.
4. Run `node scripts/poke-scheduler.js` to reseed with the new dates.
5. Watch script: new pending rows appear with later `scheduled_for`
   dates. Heartbeat count should grow (longer window = more heartbeats).

### Expected

- In the dashboard's CadenceCard, "View all" shows the new schedule.
- The participant gets NO new SMS — only the planner sees the change.

---

## Scenario 3 — Participant declines

**Goal**: Participant taps "I'm not coming" → marked declined, no more
nudges, planner sees them in the dashboard as opted-out.

### Setup

```bash
node scripts/launch-test-trip.js \
  --planner-phone +1YOURPHONE \
  --participant +1FRIEND1 \
  --participant +1FRIEND2 \
  --book-by-days 5 \
  --name "__e2e__ Scenario 3"
```

### What to do

1. On participant 1's phone, open the survey link.
2. After entering name, tap the "out" / "I can't make it" button on the
   RSVP step.
3. Watch script: participant 1 should flip to `declined` (red).
4. Confirm participant 1 gets a confirmation SMS:
   *"Thanks for letting us know. [Planner] has been notified you can't
   make the trip..."*
5. Wait for the next 15-min cron tick (or `node scripts/poke-scheduler.js`).
6. Watch script: pending nudges for participant 1 should flip to
   `skipped (already_responded)`. Participant 2's nudges still pending.
7. Verify participant 1 receives NO further SMS over the next 30 min.

### Expected

- The dashboard's PARTICIPANTS list shows participant 1 with the
  "Opted out" badge (or similar).
- The cadence card for participant 1 reads `0 upcoming`.

---

## Scenario 4 — Responses-due passes with a holdout

**Goal**: Deadline hits with one non-responder → ResponsesDueCard
appears → planner uses "Lock without holdouts" → tailored holdout SMS
goes to the laggard.

### Setup

Use a 4-day book-by so responses_due = 1 day from now. Then manually
push it into the past after the participants are set up.

```bash
node scripts/launch-test-trip.js \
  --planner-phone +1YOURPHONE \
  --participant +1FRIEND1 \
  --participant +1FRIEND2 \
  --book-by-days 4 \
  --name "__e2e__ Scenario 4"
```

### What to do

1. On participant 1's phone, complete the survey + vote on a poll
   (you'll need to add one in the planner app first).
2. Leave participant 2 alone — they're the holdout.
3. In a Supabase SQL console (or via `supabase db query --linked`),
   move the deadline into the past:
   ```sql
   UPDATE trips SET responses_due_date = current_date - 1
   WHERE name = '__e2e__ Scenario 4';
   ```
4. Run `node scripts/poke-scheduler.js`. The scheduler should auto-
   generate a recommendation (recommendation_created in the JSON output).
5. In the planner app, refresh the dashboard. Confirm:
   - **ResponsesDueCard** appears at top with "Responses were due
     today" + holdout chip showing participant 2.
   - **DecisionQueueCard** shows the auto-generated recommendation.
6. Tap "Approve" on the recommendation. Within ~10 sec:
   - Participant 1 (responder) gets:
     *"Locked in: [option] for the destination. See the full plan: ..."*
   - Participant 2 (holdout) gets the **tailored** body:
     *"The group locked in [option] for the destination. https://...
     Let [Planner] know if you're still in. Tap to update your answers: ..."*

### Expected

- The two SMS bodies are visibly different. The holdout body mentions
  the planner's name and the survey link explicitly.
- Watch script's THREAD section shows two outbound rows with
  `sender_role` values `rally_lock_responder` vs `rally_lock_holdout`.

---

## Scenario 5 — Inbound participant SMS surfaces to planner

**Goal**: Participant texts Rally a free-form message → planner gets a
push notification + the message appears in the dashboard inbox.

### Setup

Use any active fixture trip with a participant phone you control.

### What to do

1. From participant phone, send any text to Rally (`+16624283059`).
   Examples: *"What time should we land?"*, *"Can I bring a +1?"*
2. Within ~5 sec:
   - Participant phone should get the auto-redirect:
     *"Thanks for the message. I'm Rally — I just send the survey
     links and reminders, I don't have a way to chat back. For trip
     questions, reach out to [Planner first name] directly..."*
   - **Planner phone** should receive an Expo push notification:
     "Test 1 replied" + first ~60 chars of the message.
3. In the planner app, open the trip dashboard. The Inbox card should
   show the message with an unread (orange) dot.
4. Tap the message → opens the planner's native SMS app pre-filled to
   the participant's number.
5. Tap "Mark all as seen" — the unread dot disappears.

### Expected

- The redirect copy includes the planner's actual first name (looked
  up from `trip_sessions.planner_user_id` → `users.display_name`).
- If you send another message from the same phone within ~30s of acking,
  it should re-surface as a NEW unread (each message gets its own row).

---

## Scenario 6 — Undo lock within 5-minute window

**Goal**: Planner approves a decision, immediately realizes it was
wrong, taps Undo → recommendation reverts to pending.

### Setup

Same as Scenario 1, but stop after step 9 (just after approving the
recommendation).

### What to do

1. Right after tapping "Approve", the dashboard's DecisionQueueCard
   should show a "Just locked · undo within 5 min" section with a
   countdown timer (~5:00 → 4:59 → ...).
2. Tap "Undo".
3. Confirm the alert ("This re-opens the decision...") and tap "Undo".
4. Watch script: the recommendation should flip back to `pending`.
   The poll's `decided_option_id` is cleared.
5. Run `node scripts/poke-scheduler.js` — the scheduler should NOT
   regenerate a duplicate recommendation (the existing pending row
   blocks via the unique partial index).
6. Wait > 5 min after the original approval. The "Just locked" section
   should disappear from the card. Approving again starts a new 5-min
   window.

### Expected

- The participant SMS that already went out CANNOT be unsent — that's a
  documented limitation. The planner is responsible for a follow-up
  broadcast if the lock was wrong.
- The recommendation row's `planner_action_at` is cleared, so the next
  approve creates a fresh 5-min undo window.

---

## After every scenario

Always run cleanup before the next test, otherwise stale fixtures
accumulate in production:

```bash
node scripts/cleanup-test-trip.js
```

Or wipe everything in one shot:

```bash
node scripts/cleanup-test-trip.js --all
```

## When something goes wrong

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| No initial SMS within 30s of `--poke` | Twilio TFN throttle, or scheduler error | Check `supabase functions logs sms-nudge-scheduler --tail`. Scheduler returns the failure reason in JSON. |
| Survey link returns "Trip is no longer accepting responses" | `responses_due_date` is in the past | Update `trips.responses_due_date = NULL` to let the trigger re-derive from `book_by_date`. |
| Watch script shows nudges as `pending` for hours | The cron isn't running, or scheduler is broken | Run `node scripts/poke-scheduler.js` and watch the output. If `seed.sessions=0` your trip has no `book_by_date`. |
| Push notification for inbound never arrives | Planner has no `push_tokens` row | The planner phone needs to have opened the Rally app + accepted notification permission at least once. |
| "Approve" succeeds but no SMS goes out | Service role JWT in `vault.secrets` is wrong, or `EXPO_PUBLIC_SUPABASE_URL` not set in the app | Check `supabase db query --linked "SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='service_role_key';"`. |
| Unique constraint violation on launch | A previous fixture wasn't cleaned up | `node scripts/cleanup-test-trip.js --all` |

## Tracing a single SMS end-to-end

If anything goes sideways, this is the order to look:

1. **App-side log**: did the planner action succeed? Check the trip's
   poll status (`status='decided'`?) via `supabase db query`.
2. **Edge function log**: `supabase functions logs sms-nudge-scheduler
   --tail` (or `sms-lock-broadcast --tail`). Look for the relevant row's
   `[scheduler]` / `[broadcast]` log lines.
3. **DB row**: `nudge_sends` for the participant — what's the
   `sent_at` / `skipped_at` / `skip_reason` / `message_sid`?
4. **Twilio console**: paste the `message_sid` into Twilio's message
   logs to see if it was actually delivered (or rejected at the carrier
   level). Toll-free numbers can be filtered as spam by some carriers
   even after A2P verification.
5. **PostHog**: filter events by `trip_session_id` to see the full
   timeline (nudge_scheduled → nudge_sent → recommendation_created
   → recommendation_approved → lock_broadcast_sent).
