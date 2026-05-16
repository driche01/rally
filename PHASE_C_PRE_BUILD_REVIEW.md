# Phase C — Pre-Build Review

**Status:** awaiting human review (per CLAUDE.md hard rule + build guide §Phase 0).
**Date:** 2026-05-12.
**Branch:** `claude/eager-sanderson-00015d`.
**Tip:** `b07afb3` (flyer removal landed on Phase B's last commit `caebd16`).

This doc reconciles the Phase C build guide with what Phase A and Phase B actually shipped. **No Phase C code lands until you sign off below.**

---

## TL;DR — what's at stake

Phase C wants to build the outbound-SMS coverage that backs every key moment in the trip lifecycle: auto reminders (RSVP, profile-completion, booking, pre-trip-summary, re-engagement), planner blasts with rate limits + carrier compliance, cohost parity, stall detection, and cancel-trip. Most of the design is buildable as written, but the guide assumes Phase A built two artifacts that **we explicitly didn't build** (Q5 + Q3 resolutions): an `sms_messages` table and a `trip_memberships` table. Everything in this review flows from reconciling those two divergences. Net effect: the schema additions are still additive-only, but several FK targets in the build guide change from what's printed.

There are also 8 open Q's (Q18–Q25) where Phase C re-raises questions analogous to Phase A/B that need the same resolution applied. My recommendation on every one matches the pattern already locked in.

---

## What I learned from Phase A and Phase B (relevant to C)

### Phase A
- **Q1 — identity FK targets:** planner-side → `profiles(id)`, invitee/SMS-side → `users(id)`. **This is the convention every Phase C planner-facing column needs to follow.**
- **Q3 — membership model:** invitees live in `respondents`, NOT `trip_memberships`. There is no `trip_memberships` table in prod. Cohosts live in `trip_cohosts (trip_id, user_id → profiles(id), invited_by, created_at)`.
- **Q5 — SMS log:** **there is no `sms_messages` table.** Phase A added `trip_id` + `message_type` columns to the existing `thread_messages` and routed outbound SMS through `_sms-shared/dm-sender.ts`. `message_type` is a nullable `text` column with **no CHECK constraint**, so new values can be added at the app layer with zero DDL.
- **Q7 — scheduler isolation:** Phase A built `sms-rsvp-nudge-scheduler` as a NEW edge function (not extending the legacy `sms-nudge-scheduler` poll cadence). Same pattern should apply to the rest of the reminder types in Phase C.
- **Phase A open work still open** ([PHASE_A_DEMO.md](PHASE_A_DEMO.md#things-that-need-follow-up-before-alpha-launch)):
  - `sms-rsvp-nudge-scheduler` is built but **not deployed** and **has no pg_cron entry**.
  - Migrations 114 and 115 in the parent repo are uncommitted/unapplied. 114 (paywall artifacts drop) is fine; 115 (`trip_nudge_overrides`) is referenced by phone-app SMS work but isn't on prod.

### Phase B
- **Q13 — per-member FK target:** all per-member FKs target `respondents(id)`. This is what made voting / room assignment / cook assignment / shopping claims work for invitees without Rally accounts, gated by `session_token`. **The exact same logic applies to Phase C `recipient_membership_id`.**
- **Cohost parity is already wired uniformly in Phase B routes.** Every Phase B AI generation + voting + assignment route checks `trip.created_by === auth.uid()` OR `trip_cohosts.user_id` membership. The invitations API does the same. Phase C section 6 ("audit and broaden host-only checks") is therefore **largely a no-op** — the pattern is established; the only gaps left to audit explicitly are: trip overview "Cancel trip" (deferred from Phase A, was disabled), and the new blast composer + reminder-settings UIs introduced by Phase C themselves.
- **Sharp edge from PHASE_B_DEMO.md:** the planner needs a `respondents` row on their own trip to interact with member-facing features (votes, etc.). For Phase C this matters because a blast addressed to "Going members" needs to optionally include the planner (and currently planners often don't have a self-respondents row).

### Existing infra you can reuse (don't rebuild)
| Capability | Lives at | Use for |
|---|---|---|
| Outbound 1:1 SMS rail | `_sms-shared/dm-sender.ts` (`sendDm`, `broadcast`) | Every Phase C send path |
| SMS personalization tokens | `_sms-shared/personalize.ts` | Reminder + blast body interpolation |
| STOP / REJOIN / opt-out flip | `sms-inbound` edge fn + `_sms-shared/inbound-processor.ts` writes `users.opted_out=true` | Already complete — Phase C just needs to ensure the send rail checks `opted_out` before send |
| Templates + opt-out tail copy | `_sms-shared/templates.ts`, `_sms-shared/planner-notify.ts` | Reuse "Reply STOP to opt out." pattern (already there) |
| Skip rules + cadence helpers | `_sms-shared/skip-rules.ts`, `_sms-shared/cadence.ts` | Quiet hours, per-recipient rate limit, dedupe |
| Existing scheduler pattern | `sms-rsvp-nudge-scheduler/` (read its docstring — has pg_cron snippet) | Copy this skeleton for each new reminder type, or merge into one polyglot scheduler |
| Phone → user lookup | `_sms-shared/phone-user-linker.ts` (includes `opted_out` field) | Lookup recipient identity before send |
| Planner-side host gate | `requirePlanner`-style inline checks in every Phase B route | Copy for blast + reminder-settings endpoints |

### Phase A SMS data so far (alpha hasn't started)
Per CLAUDE.md hard rule there's no alpha cohort live yet, so there's no real SMS history to mine for tone/timing/failure-rate signal. The "read Phase A `sms_messages` table data" step in the Phase C guide is **not yet actionable** — defer that learning loop until after alpha. We'll instrument analytics with the `phase_b_generation_log` pattern (per-call cost log) but for SMS rather than AI, using `thread_messages` queries.

---

## Conflicts surfaced between the Phase C guide and reality

### C1 — `sms_messages` doesn't exist; we use `thread_messages`
**Guide says:** "`sms_messages` (already exists from Phase A) — extend message_type enum: Add: `lodging_vote_open`, `lodging_locked`, …"
**Reality:** there's no `sms_messages`. The SMS log is `thread_messages`. The column `thread_messages.message_type` is **nullable text with no CHECK**, so new values are zero-DDL.
**Recommendation:** keep using `thread_messages`. Phase C adds these values at the app layer in a typed string-union (mirrors how all enum-like values are handled today — Q6 convention). Update the Phase C FK references:
- `scheduled_reminders.sent_sms_message_id` → `thread_messages.id`
- `planner_blast_sends.sms_message_id` → `thread_messages.id`
**Net effect on additivity:** no DDL needed for `thread_messages`. Phase C still gets to gain new `message_type` values cleanly.

### C2 — `trip_memberships` doesn't exist; we use `respondents`
**Guide says:** "`recipient_membership_id uuid references trip_memberships.id`" in `scheduled_reminders` and `planner_blast_sends`.
**Reality:** invitees and going-members live in `respondents`. Per Q13, every per-member Phase B FK already targets `respondents(id)`.
**Recommendation:** all per-member Phase C FKs target `respondents(id)`. Rename the column from `recipient_membership_id` to `recipient_respondent_id` so the schema is self-documenting. This is Q18 below — recommendation is locked.

### C3 — `planner_blasts.composed_by → users.id` should be `→ profiles(id)`
**Guide says:** `composed_by uuid references users.id`.
**Reality:** Per Q1, planner-side FKs target `profiles(id)`. The blast composer is authenticated planner-or-cohost only.
**Recommendation:** `composed_by uuid references profiles(id)`. This is Q20 below.

### C4 — `sms-broadcast` edge function already exists (for the LEGACY poll cadence)
**Guide says:** build a new blast send pipeline.
**Reality:** `supabase/functions/sms-broadcast/index.ts` exists, JWT-gated, broadcasts 1:1 to every active participant of one of the planner's `trip_session_id` (the Expo poll concept). Keyed on `trip_session_id`, not `trip_id`.
**Recommendation:** **build a new `sms-trip-blast` edge function**, isolated from the legacy `sms-broadcast`. Same isolation pattern as Q7. Keyed on `trip_id` + `respondents`. Reuses `_sms-shared/dm-sender.ts`. Do not touch `sms-broadcast`. This is Q21 below.

### C5 — Phase A reminder scheduler is built but not deployed
**Guide says:** auto reminders run via a cron worker.
**Reality:** `sms-rsvp-nudge-scheduler` is written, not deployed, no cron entry. Phase A doc flagged this for "pre-alpha follow-up."
**Recommendation:** as Step 0 of Phase C, deploy `sms-rsvp-nudge-scheduler` AND establish the pg_cron entry. Then either:
- (a) Extend `sms-rsvp-nudge-scheduler` to handle all five reminder types (single polyglot scheduler), or
- (b) Build per-type schedulers (each its own edge fn).
**My recommendation:** (a) single polyglot scheduler. Reads `scheduled_reminders WHERE status='pending' AND scheduled_for <= now()`, branches by `message_type` for body + skip-rule logic. One pg_cron entry, one deploy step, one log stream. The Phase A scheduler becomes the template — its body+dedupe logic for `rsvp_nudge` slots in as one case in the switch. This is Q22 below.

### C6 — Phase A self-respondent sharp edge
**PHASE_B_DEMO.md flagged:** planners often don't have a self-respondent row, which broke their ability to vote on their own trip.
**For Phase C:** this matters for blasts addressed to "All members" or "Going members" — should the planner receive a blast they composed?
**Recommendation:** auto-create a self-respondent row for the planner at trip creation time (one-line fix flagged in Phase B). Phase C blast send pipeline then has a `include_planner: bool` flag (default false — don't blast yourself). Q24 below.

### C7 — Time zone resolution for quiet hours
**Guide says:** "Do not send between 9pm and 9am in recipient's local time zone (use `home_airport` as a proxy for time zone, or fall back to phone area code)."
**Reality:** `traveler_profiles.home_airport` is captured in Phase A. No IATA→tz mapping ships today. Phone area code → tz also not implemented.
**Recommendation:** ship a static `iata_to_tz.json` in `/shared/` covering the ~500 most common airports (one-time data drop, no API dependency). Phone area code is **not** a reliable fallback — many area codes span multiple zones and many phones live far from their issuing zone. If no `home_airport`, treat the recipient as **America/New_York** (the alpha cohort's anchor zone) and defer better resolution to a follow-up. Q25 below.

### C8 — STOP / opt-out for anon respondents
**Guide says:** "Track opt-outs in a user-level field; opted-out users never receive any SMS again."
**Reality:** `users.opted_out` exists. `sms-inbound` flips it on STOP. But `respondents.user_id` is nullable — many invitees never get a `users` row before they RSVP.
**Recommendation:** every send path **resolves the recipient phone → `users` row** (creating one if missing, per the existing `phone-user-linker.ts` pattern) and checks `opted_out` there. This is already what `_sms-shared/dm-sender.ts` does. The remaining work in Phase C is just: **never bypass `dm-sender.ts` for sends.** No new schema needed. Q23 below.

### C9 — `cancellation_notice` recipient segment
**Guide says:** Cancel Trip sends `cancellation_notice` to every member (Going, Maybe, Invited).
**Reality:** opt-out check still needs to gate this (legally required), and `cant_go` people should arguably also get notice (their plans changed). Worth confirming.
**Recommendation:** send `cancellation_notice` to **everyone with a `respondents` row** (going / maybe / invited / cant_go), respecting `users.opted_out`. Carrier-compliance opt-out doesn't override the trip planner's right to inform people of a cancellation, but in practice we should still suppress opted-out recipients to stay safe. Worth confirming with you. Q26 below.

### C10 — Cancel Trip + locking the trip page
**Guide says:** "Lock the trip page in a 'Cancelled' state — feed visible but no new RSVPs or activity allowed."
**Reality:** RLS policies on RSVPs / activity feed don't currently consider `cancelled_at`. We'll need to either widen each RLS policy or gate at the API layer.
**Recommendation:** gate at the API layer (every write route checks `if (trip.cancelled_at) return 410 gone`). RLS layer-only would require a migration touching multiple policies — riskier than a single app-layer check. No new question — this is just an implementation note.

### C11 — Rate limit math is app-layer-only
**Guide says:** 3/week per trip, 10/trip lifecycle, 2/24h per recipient.
**Reality:** no schema changes needed for this — all three limits are SELECT-COUNT queries against `planner_blasts` (new) + `thread_messages` (existing). The 2/24h cross-source limit must consider both reminders and blasts — query both. No new question.

### C12 — Re-engagement flow targets the planner
**Guide says:** "Designed to nudge planners back into action via a 'your trip needs love' message to the planner specifically."
**Reality:** `_sms-shared/planner-notify.ts` already exists with a "Reply STOP to opt out." template pattern. Reuse it for the planner re-engagement nudge body.
**Recommendation:** no new question — just reuse the existing helper. Note this in the Step 4 implementation.

---

## Open questions (Q18–Q26) — recommendations and what I need from you

All carry recommendations. Mark each `RESOLVED: [decision]` to unblock.

### Q18 — Per-member FK target for Phase C tables
**Question:** Same as Q13 — should `scheduled_reminders.recipient_*` and `planner_blast_sends.recipient_*` target `respondents(id)` or `trip_memberships(id)`?
**Recommendation:** `respondents(id)`. Rename the column `recipient_respondent_id` for clarity.
**Status:** RESOLVED 2026-05-12 — `respondents(id)`. Column name `recipient_respondent_id`.

### Q19 — SMS log target
**Question:** Same as Q5 — do we build a new `sms_messages` table or keep using `thread_messages`?
**Recommendation:** keep `thread_messages`. `message_type` is unconstrained text; Phase C just adds new values at the app layer.
**Status:** RESOLVED 2026-05-12 — keep `thread_messages`. New `message_type` values added at the app layer.

### Q20 — `planner_blasts.composed_by` FK
**Question:** Same as Q1 — `profiles(id)` or `users(id)`?
**Recommendation:** `profiles(id)` (planner-side).
**Status:** RESOLVED 2026-05-12 — `profiles(id)`.

### Q21 — Trip-blast send pipeline
**Question:** Extend the legacy `sms-broadcast` edge function (keyed on `trip_session_id`) or build a new `sms-trip-blast`?
**Status:** RESOLVED 2026-05-12 — build a clean new `sms-trip-blast` edge function. Reuses `_sms-shared/dm-sender.ts`. Designed for the Phase C contract (`trip_id` + segment via `respondents`, host-or-cohost auth, Phase C rate limits, auto-post to `activity_feed_entries`). The legacy `sms-broadcast` and its session-cadence siblings go on the post-Phase-C cleanup list ([LEGACY_CLEANUP.md](LEGACY_CLEANUP.md)). Rationale: no users on legacy v1 SMS surfaces, no point grafting Phase C semantics onto a function not designed for them.

### Q22 — Reminder scheduler shape
**Question:** Single polyglot scheduler that handles all five reminder types via a switch on `message_type`, OR five per-type schedulers?
**Recommendation:** single polyglot scheduler. Builds on the existing `sms-rsvp-nudge-scheduler` skeleton (the `rsvp_nudge` path becomes one case in the switch). One pg_cron entry, one deploy, one log stream.
**Status:** RESOLVED 2026-05-12 — single polyglot scheduler.

### Q23 — Opt-out gating at the send rail
**Question:** Confirm `_sms-shared/dm-sender.ts` already enforces `users.opted_out` and Phase C just needs to never bypass it. Anything else?
**Recommendation:** confirm + adopt a hard convention: **every Phase C send goes through `dm-sender.ts`. No direct Twilio calls.** Add a comment to that effect at the top of every new send path. No schema change needed.
**Status:** RESOLVED 2026-05-12 — every Phase C send goes through `dm-sender.ts`. No direct Twilio calls.

### Q24 — Auto-create planner self-respondent
**Question:** Should trip creation auto-create a `respondents` row for the planner (`name=profiles.display_name`, `phone=profiles.phone`, `is_planner=true`, `rsvp_status='going'`)? Fixes the sharp edge from Phase B AND lets the planner be addressed by blasts uniformly.
**Recommendation:** yes. Add to trip creation (`/api/trips`) as part of Phase C Step 1. The blast pipeline then defaults `include_planner=false` to avoid blast-yourself confusion, with an `Also send to me` checkbox in the composer for hosts who want their own copy.
**Status:** RESOLVED 2026-05-12 — yes, auto-create. Blast composer defaults `include_planner=false` with "Also send to me" checkbox.

### Q25 — Quiet-hours time zone resolution
**Question:** Static `iata_to_tz.json` for `home_airport` lookup, with `America/New_York` fallback for missing airport?
**Status:** RESOLVED 2026-05-12 — **home_airport becomes REQUIRED at profile capture (not skippable).** No NYC default for users who have completed a profile. Static `iata_to_tz.json` ships in `/shared/` for the lookup. Phase A traveler_profiles capture must be tightened to make home_airport non-skippable; existing `traveler_profiles` rows missing `home_airport` get a one-time SMS asking the recipient to fill it in before they can be sent quiet-hours-sensitive nudges.

**Q25a (raised by Q25 resolution):** how do we handle quiet-hours gating for recipients who don't have a profile yet — i.e., the `invited` segment of blasts (haven't RSVPed, so no `traveler_profiles.home_airport`)?
**Status:** RESOLVED 2026-05-12 — fall back to the **sender's local timezone** for these recipients. The blast composer surfaces this explicitly ("Recipients without a profile will receive this in your local time window").

### Q26 — Cancellation notice + opt-out interaction
**Question:** Send `cancellation_notice` to opted-out recipients too (informational, not promotional)?
**Recommendation:** **no.** Suppress opted-out recipients even for cancellation notices, to stay legally + ethically safe. Show the planner a "N recipients opted out and won't be notified — let them know directly" message at the bottom of the cancel modal.
**Status:** RESOLVED 2026-05-12 — suppress opted-out recipients. Cancel modal surfaces the suppressed count + recipient names.

---

## Schema additions Phase C will need (preview only — full plan in `SCHEMA_PLAN.md` post-sign-off)

All additive. Targets resolve to the recommendations above.

| Migration | Adds |
|---|---|
| `135_phase_c_scheduled_reminders.sql` | `scheduled_reminders` (`recipient_respondent_id → respondents(id)`, `sent_thread_message_id → thread_messages(id)`) |
| `136_phase_c_planner_blasts.sql` | `planner_blasts` (`composed_by → profiles(id)`, `activity_feed_entry_id → activity_feed_entries(id)`) |
| `137_phase_c_planner_blast_sends.sql` | `planner_blast_sends` (`recipient_respondent_id → respondents(id)`, `thread_message_id → thread_messages(id)`) |
| `138_phase_c_trip_reminder_settings.sql` | `trip_reminder_settings` (PK = `trip_id`) |
| `139_phase_c_trips_cancelled.sql` | `trips.cancelled_at timestamptz NULL`, `trips.cancelled_by → profiles(id) NULL` |
| `140_phase_c_self_respondent_backfill.sql` | One-time backfill: insert missing `respondents` rows for all `trips.created_by` planners (per Q24) |

Plus app-layer enum additions to `thread_messages.message_type`:
`lodging_vote_open`, `lodging_locked`, `itinerary_vote_open`, `final_headcount`, `cancellation_notice`, `re_engagement`, `profile_completion_nudge`, `booking_nudge`, `pre_trip_summary`, `planner_blast`.

Zero DDL changes to existing columns. Zero DROPs. Zero RENAMEs.

### Indexes (all on new tables)
- `scheduled_reminders (scheduled_for, status)` — cron worker hot path
- `scheduled_reminders (trip_id, message_type)` — cancel-condition lookups
- `planner_blasts (trip_id, sent_at desc)` — composer history view
- `planner_blast_sends (blast_id)`, `planner_blast_sends (recipient_respondent_id)`
- `trip_reminder_settings (trip_id)` — implicit by PK

---

## Phase 0 Pre-build deploys (before Step 1)

These are stragglers from Phase A that block Phase C cleanly. All should happen at the very top of Phase C:

1. **Deploy `sms-rsvp-nudge-scheduler`** edge function to prod.
2. **Add pg_cron schedule** (6-hour cadence per the function's docstring snippet).
3. **Confirm `users.opted_out` flow** end-to-end by sending a test STOP and verifying the next outbound is blocked.
4. **Decide on migration 115** (`trip_nudge_overrides`, exists locally but not on prod). If we want per-trip nudge body overrides for Phase C reminders + blasts, apply it. Otherwise leave it alone.

---

## What I'm NOT recommending

- **Don't build `sms_messages`.** Already covered by `thread_messages` with the existing extension columns.
- **Don't build `trip_memberships`.** `respondents` is the source of truth for membership state.
- **Don't introduce Postgres enum types** (per Q6 — text + CHECK or unconstrained text everywhere).
- **Don't extend `sms-broadcast`** or `sms-nudge-scheduler` (legacy poll cadence — isolated).
- **Don't try to mine SMS data from alpha** — alpha hasn't started. Instrument now, learn later.
- **Don't add phone-area-code timezone resolution.** Unreliable; defer until we have a real signal that the static IATA map is failing too often.
- **Don't build inbound parsing or NLU.** Phase C is outbound-only. STOP/REJOIN handling already lives in `sms-inbound` and is treated as carrier compliance, not "two-way conversation."

---

## Build order (preview, post-sign-off)

Matches the Phase C guide §2 build order, with the Phase 0 deploys above prepended.

0. (Phase 0) Deploy `sms-rsvp-nudge-scheduler`, set pg_cron, smoke-test STOP, decide on migration 115.
1. Schema additions (six migrations 135–140).
2. Single polyglot scheduler: extend `sms-rsvp-nudge-scheduler` to handle all five reminder types.
3. `sms-trip-blast` edge function + rate-limit math.
4. Planner Blast composer UI (host/cohost only).
5. Blast → activity feed auto-post.
6. Cohost permissions audit — likely just the new Phase C surfaces (composer + reminder settings + cancel modal).
7. Re-engagement: detection signals + planner SMS + dashboard banner.
8. Cancel Trip flow end-to-end.

---

## What I need from you to unblock Phase C

1. **Resolve Q18–Q26** above. Each carries a recommendation. Easiest path: reply `Q18 ✓ … Q26 ✓` if you agree with every recommendation; flag exceptions.
2. **Confirm the Phase A deploy stragglers** (`sms-rsvp-nudge-scheduler` deploy + pg_cron + migration 115 decision) can happen as part of Phase C Phase 0.
3. **Decide whether to address PHASE_B_DEMO.md's open items first** (invitee-side voting UI, real-time vote updates, etc.) or push them past Phase C.

Once those are answered I'll write `SCHEMA_PLAN.md` for migrations 135–140, wait for sign-off on the plan per hard rule #3, then run the migrations and start build.

Per CLAUDE.md hard rule + build guide §Phase 0: **stopping here.**
