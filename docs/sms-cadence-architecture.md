# SMS Cadence Architecture

Single-page reference for the survey-based 1:1 SMS pivot (built 2026-04-25/26).

## What this system does

Rally drives a deterministic nudge cadence over 1:1 SMS, keyed to a planner-set
**book-by date**. Participants respond via a stateless web survey (no app,
no login). When responses converge or the deadline hits, Rally generates
recommendations the planner can lock with one tap; locks broadcast to the
group via SMS.

The surface is deliberately narrow: there is **no conversational SMS**. Inbound
messages get a soft auto-redirect to the planner and surface in the dashboard
inbox.

## Data model

```
trips                       app-side trip metadata, including book_by_date,
                            responses_due_date (auto = book_by - 3), custom_intro_sms
  └─ trip_sessions          1 per trip; SMS-side state machine container
       ├─ trip_session_participants    rsvp + activity per participant phone
       │   └─ last_activity_at         touched by inbound SMS + survey activity
       └─ nudge_sends                  one row per (participant, nudge_type)
                                       sent_at IS NULL = pending
                                       skipped_at IS NULL + reason = skipped

  ├─ polls                  destination / dates / budget / custom
  │   └─ poll_options
  │   └─ poll_responses     one per (poll, respondent, option)
  └─ poll_recommendations   Rally's pending pick per poll (one pending at a time
                            via unique partial index)

respondents                 survey-fillers, indexed by (trip_id, phone)
thread_messages             inbound + outbound SMS log
```

## Lifecycle (planner POV)

1. **Create trip** with book-by date → trigger fills `responses_due_date = book_by - 3`.
   `createTrip` calls `app_create_sms_session` and pokes the scheduler.
2. **Share invite link** → friends fill out web form → SMS confirmation handshake →
   `confirm_join_submission` promotes them to `trip_session_participants`.
3. **Cron tick (every 15 min)** seeds `nudge_sends` for each new participant and
   fires due rows. Cadence per (participant, kind):
   `initial → d1 → d3 → [heartbeats every 21d if quiet > 21d] → rd-2 → rd-1`.
4. **Participants respond** via the survey. Each meaningful response touches
   `last_activity_at` (DB trigger) and exempts them from further nudges
   (scheduler's `hasResponded` check).
5. **Responses-due passes**: scheduler stops seeding new nudges, generates
   `poll_recommendations` for every live poll, surfaces them in the dashboard's
   pinned `DecisionQueueCard`. Planner sees the `ResponsesDueCard` banner with
   three actions (lock / one-more-nudge / extend-deadline).
6. **Planner approves a recommendation** → `approve_poll_recommendation` RPC
   marks the poll decided, syncs trip fields, and the client fires the lock
   broadcast SMS via `broadcastDecisionLock`.
7. **Participants** see the lock confirmation in their 1:1 thread; can tap
   `/summary/[token]` for the locked details (+ `/results/[token]` for live
   poll totals at any point).

## Cron tick (`sms-nudge-scheduler`)

Runs every 15 minutes via `cron.schedule('sms-nudge-scheduler-every-15min')`.
Two passes per tick:

**SEED** — for each active trip session with `book_by_date`:
- If `responses_due_date` has passed, skip seeding and call
  `generateRecommendationsForTrip` instead (idempotent — unique partial
  index on `(poll_id) WHERE status='pending'` blocks dupes).
- Otherwise, for each active+attending non-planner participant, compute the
  cadence (`computeCadence` — pure math, mirror of `src/lib/cadence.ts`)
  and upsert into `nudge_sends`. Unique partial index dedupes against
  in-flight rows.

**FIRE** — walk `nudge_sends WHERE scheduled_for <= now() AND sent_at IS NULL
AND skipped_at IS NULL`, capped at 200 per tick. For each:
- Skip if participant inactive / has responded / session missing.
- Otherwise build the body (`buildSmsBody`), `sendDm`, stamp `sent_at` +
  `message_sid`.

Telemetry: `nudge_scheduled`, `nudge_sent`, `nudge_skipped(reason)`,
`recommendation_created`. All via `track()` (PostHog server-side capture).

## Inbound SMS

`sms-inbound` (TwiML webhook) routes everything through `inbound-processor.ts`:

1. Idempotency check on `MessageSid`
2. Claim-OTP echo silencer (drops 6-digit replies during account claim)
3. Join-link YES/NO → `confirm_join_submission` RPC
4. APP keyword → install link reply
5. STOP / REJOIN → carrier compliance (sets `users.opted_out`)
6. **Default**: soft redirect with planner first-name + log to `thread_messages`
   with `needs_planner_attention=true` + push notification to planner devices

The dashboard's `Inbox card` reads from `thread_messages` filtered by
`needs_planner_attention=true AND planner_acknowledged_at IS NULL`. Planner
taps "Mark all as seen" → `ack_planner_inbox_for_trip` RPC clears the badge.

## RPC boundary

Auth-gated (`auth.uid()` required, `SECURITY DEFINER`):
- `app_create_sms_session(trip_id)` — planner creates SMS session for a trip
- `create_join_link(trip_session_id)` — planner mints a join code
- `request_poll_recommendation(poll_id)` — planner asks Rally to recommend
- `approve_poll_recommendation(rec_id, [override_option_id])` — planner locks
- `hold_poll_recommendation(rec_id, [hold_until])` — planner defers
- `send_nudge_now(session_id, [participant_id])` — fire next pending nudge
- `skip_next_nudge(session_id, [participant_id])` — mark next as skipped
- `pause_participant_nudges(session_id, participant_id)` — bulk skip per person
- `ack_planner_inbox_message(message_id)` — clear one inbox item
- `ack_planner_inbox_for_trip(trip_id)` — bulk clear

Anon-callable:
- `submit_join_link(code, phone, name, email?)` — survey form
- `get_join_link_preview(code)` — render `/join/[code]`
- `get_aggregate_results_by_share_token(token)` — render `/results/[token]`

Service-role only (no GRANT):
- `confirm_join_submission(phone, decision)` — promotes pending submission
- `resolve_inbound_for_planner(phone)` — inbound processor lookup

## Triggers

- `trips_default_responses_due_date` — INSERT/UPDATE OF book_by_date,
  responses_due_date — auto-derives `responses_due = book_by - 3` unless
  caller writes an explicit value in the same statement (the planner-extend
  override path).
- `trips_reseed_nudges_on_due_change` — AFTER UPDATE OF responses_due_date
  — soft-cancels pending nudges so the next tick reseeds with the new
  schedule.
- `respondents_touch_participant_activity` — AFTER INSERT/UPDATE OF rsvp,
  preferences — touches `last_activity_at` for the matching participant
  so the dashboard can show "Responded 2h ago".

## Edge functions

| Function | Endpoint | Auth | Purpose |
| --- | --- | --- | --- |
| `sms-inbound` | TwiML webhook | Twilio signature | Inbound router |
| `sms-broadcast` | POST | JWT | Planner fan-out |
| `sms-join-submit` | POST | anon | Web form submit |
| `sms-nudge-scheduler` | POST | service-role (cron) | SEED + FIRE per tick |
| `sms-survey-confirmation` | POST | anon | Per-day idempotent submit confirmation |

## Operational notes

- **Migrations 044–052** ship the cadence/queue/inbox stack. They are
  additive (`ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`,
  `CREATE OR REPLACE FUNCTION`) and idempotent.
- **Cron name** `sms-nudge-scheduler-every-15min` is distinct from the
  retired `sms-nudge-every-10min` (migration 042 unscheduled the old one).
- **Service-role JWT is hardcoded** in migration 046's cron config. Worth
  moving to a Supabase secret later — secret in source control is a
  legacy pattern.
- **Web preview is a static export.** New `app/**/*.tsx` routes don't
  appear in `dist-preview/` until `npx expo export --platform web --output-dir dist-preview`
  is re-run. The dev server is just `serve -s dist-preview`.
- **Cadence math has two implementations:** `src/lib/cadence.ts` (RN bundle)
  and `supabase/functions/_sms-shared/cadence.ts` (Deno edge function).
  Keep them in sync. RN-side has Jest coverage in `src/__tests__/cadence.test.ts`.
- **Telemetry events emitted:** `nudge_scheduled`, `nudge_sent`,
  `nudge_skipped` (with `skip_reason`), `recommendation_created`,
  `recommendation_approved`, `recommendation_held`, `lock_broadcast_sent`.
  Use these to validate the cadence is firing correctly in PostHog.

## Security posture (audited 2026-04-26)

| Table | RLS | Read policy | Writes |
| --- | --- | --- | --- |
| `nudge_sends` | enabled | trip member of session.trip_id | service role (scheduler) + planner RPCs |
| `poll_recommendations` | enabled | trip member of trip_id | service role (scheduler) + planner RPCs |
| `thread_messages` | enabled | (existing — unchanged by this work) | service role + ack RPCs |
| `trip_session_participants` | enabled | (existing — unchanged) | service role + planner RPCs |

No write policies on the new tables → authenticated callers attempting
direct INSERT/UPDATE/DELETE silently fail. All mutations flow through
SECURITY DEFINER RPCs that explicitly check `trip_members` membership.

The `share_token` column on `trips` is a 24-char hex single-use access
gate for the public webviews (`/respond/[token]`, `/results/[token]`,
`/summary/[token]`, `/status/[token]`). Anyone with the token can read
the trip's aggregate state. Tokens are not currently rotated.

JWT for the cron job is stored in `vault.secrets` under name
`service_role_key` (migration 055). Operators rotate by updating the
vault entry — no migration redeploy needed.

## Known shortcomings (worth fixing before real-user beta)

- No staging environment — migrations and function deploys go straight
  to prod.
- No rollback runbook for any of the new migrations.
- Lock-without-holdouts has no undo path.
- The `ResponsesDueCard` "Lock without holdouts" action currently scrolls
  to the decision queue rather than locking + sending a tailored holdout
  SMS distinct from the all-hands lock body.
- No integration tests against a fixture trip (only unit tests for
  cadence math).
- Service-role JWT is hardcoded in migration 046 (see above).
- The dashboard cards re-fetch on a 60s interval — fine for v1 but a
  Supabase Realtime subscription would be the proper Phase-2 upgrade.
