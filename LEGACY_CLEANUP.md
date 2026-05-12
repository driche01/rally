# Legacy Cleanup — post-Phase-C

> Running list of legacy Expo-era artifacts that are clearly dead in v1 and can be deleted once Phase C ships. Per user directive 2026-05-12: cleanup is a separate, dedicated task — Phase C does NOT touch these. The additive-only schema rule does NOT apply to drops here, because these artifacts are orthogonal to the shared mobile-app schema (the Expo app is paused and v3 mobile will be a rewrite, not a continuation).

**When to act:** after Phase C is signed off and the alpha runs cleanly on the new SMS pipeline. Not before.

**How to act:** a single dedicated cleanup PR (or two — one for edge fns, one for tables). Run a final grep across `web/`, `shared/`, `supabase/functions/_sms-shared/`, and `supabase/migrations/` for each item before deleting. The list below was greped clean as of 2026-05-12 — zero v1 references found — but re-verify before pulling the trigger.

---

## A. Confident deletes — Expo poll-cadence SMS edge functions

All session-anchored (keyed on `trip_session_id`), driven by the legacy `polls`/`trip_sessions` model that v1 doesn't use.

| Function | What it did | v1 references |
|---|---|---|
| `supabase/functions/sms-broadcast/` | Planner blasts to poll-session participants | none |
| `supabase/functions/sms-nudge-scheduler/` | Cron-driven poll-cadence nudges | none |
| `supabase/functions/sms-lock-broadcast/` | "Poll is locked" SMS | none |
| `supabase/functions/sms-stuck-trip-alert/` | "Your poll is stuck" SMS | none |
| `supabase/functions/sms-trip-finalize-prompt/` | "Finalize your poll" SMS | none |
| `supabase/functions/sms-survey-confirmation/` | Survey-completed confirmation SMS | none |

`sms-rsvp-nudge-scheduler` (Phase A) is the **replacement** for these and **stays**. After Phase C extends it to the polyglot scheduler, all reminder + cron-driven SMS flows through that one function.

`sms-inbound` (STOP/REJOIN handling) also stays — it's carrier compliance, not poll-cadence.

## B. Confident deletes — Expo AI helper edge functions (replaced by Phase B web routes)

| Function | Replaced by | v1 references |
|---|---|---|
| `supabase/functions/generate-itinerary/` | `web/app/api/trips/[id]/itinerary/generate/` | none |
| `supabase/functions/suggest-block-alternatives/` | (no v1 equivalent yet; alternatives UI is deferred) | none |
| `supabase/functions/suggest-lodging/` | `web/app/api/trips/[id]/lodging/suggest/` | none |
| `supabase/functions/suggest-travel/` | `web/app/api/trips/[id]/travel/suggest-flights/` | none |

`places-autocomplete` and `restaurant-details` need an audit before deletion — they may still serve the Expo destination picker or meal-detail flows. **Don't delete blindly.**

`member-add` and `member-remove` need an audit — the v1 invitation flow doesn't call them, but verify before delete.

## C. Confident deletes — legacy SMS-shared helpers

Only delete after both A and B are gone. Several `_sms-shared/` modules are still used by the survivors (`sms-rsvp-nudge-scheduler`, `sms-inbound`). Re-grep `_sms-shared/` consumers before any module is removed.

Likely-orphaned after A + B:
- `_sms-shared/cadence.ts` — poll-cadence definitions. Audit.
- `_sms-shared/skip-rules.ts` — used by legacy scheduler. Audit (Phase C may want a different skip-rules module).
- `_sms-shared/templates.ts` — Expo SMS body templates. Audit (Phase C reminder bodies will be in `/web/lib/sms/` or similar).

Stays:
- `_sms-shared/dm-sender.ts` — the send rail itself. Required.
- `_sms-shared/inbound-processor.ts` — STOP/REJOIN handling.
- `_sms-shared/personalize.ts` — token interpolation.
- `_sms-shared/phone.ts`, `phone-user-linker.ts` — phone normalization + user resolution.
- `_sms-shared/supabase.ts`, `twilio.ts`, `telemetry.ts`, `api-keys.ts`, `planner-notify.ts` — generic plumbing.

## D. Confident deletes — Expo poll-cadence tables

All keyed on `trip_session_id` or the `polls` model. v1 uses `trips` + `respondents` + `activity_feed_entries` instead.

| Table | Phase C / v1 alternative |
|---|---|
| `trip_sessions` | `trips` |
| `trip_session_participants` | `respondents` |
| `polls`, `poll_options`, `poll_responses`, `poll_recommendations` | (no v1 equivalent — polling is gone in v1) |
| `nudge_sends` | `thread_messages` + `scheduled_reminders` (Phase C) |
| `agent_nudge_log` | `phase_b_generation_log` (already exists) |
| `ai_itinerary_options` | `itinerary_blocks` + Phase B AI routes |

**Drop order matters:** drop FK-dependent tables before their parents. Worth a single migration that does all of them in dependency order.

`thread_messages.trip_session_id` column also goes — but only after `trip_sessions` is gone. It's nullable, so the column drop is straightforward once the references resolve to null.

## E. Audit-before-delete — uncertain v1 dependency

These may or may not be live. Verify before action:

- `conversations`, `conversation_members`, `conversation_messages`, `conversation_reactions` — Expo group chat. v1 uses `activity_feed_entries` instead, so likely dead, but the Expo chat backend may be referenced from somewhere unexpected.
- `trip_messages`, `message_reactions` — older Expo messaging tables. Same audit.
- `trip_travel_legs` — Expo travel arrangements. Phase B uses `travel_arrangements` (its own new table). Likely dead but verify.
- `day_rsvps`, `expense_splits`, `expenses` — Expo day-RSVP + expense-split. The day-RSVP UI was deleted from `app/respond/[tripId].tsx` in the mobile cleanup (2026-05-03), but the tables stay because the planner-side itinerary editor in `/mobile` still references them. **Do NOT delete** unless `/mobile` is officially abandoned.
- `respondents.rsvp` (legacy text column, replaced by `rsvp_status` in Phase A) — column-level cleanup. Low priority, no urgency.

## F. Column-level cleanups

After table drops above:
- `thread_messages.trip_session_id` — drop after `trip_sessions` is gone.
- `respondents.rsvp` — drop the legacy column once we confirm nothing reads it. The new column `rsvp_status` is what Phase A uses.
- `trips.finalize_prompt_sent_at`, `trips.stuck_alert_sent_at` — written by legacy SMS fns being deleted in A. Once those fns are gone, these columns are dead.
- `trips.cached_lodging_suggestions*`, `trips.cached_travel_suggestions*` — Expo-era caching. Phase B's caching moved to dedicated routes. Audit before drop.
- `trips.travel_window`, `trips.trip_duration`, `trips.book_by_date`, `trips.responses_due_date`, `trips.custom_intro_sms`, `trips.estimated_flight_cost_per_person`, `trips.form_draft` — Expo-era trip-form fields. Audit each.

## G. Migration drop order (sketch — for the cleanup PR)

```
1. Drop FK-dependent rows first:
   - poll_responses → polls
   - poll_recommendations → polls
   - poll_options → polls
   - trip_session_participants → trip_sessions
   - thread_messages.trip_session_id column → trip_sessions FK
   - polls → trip_sessions
   - nudge_sends → trip_sessions
2. Drop trip_sessions
3. Drop standalone tables (agent_nudge_log, ai_itinerary_options)
4. Drop columns flagged in F
5. Drop _sms-shared helpers no longer referenced
6. Delete edge function directories (A + B)
```

Each step is a separate migration with its own `INSERT INTO supabase_migrations.schema_migrations` footer (existing convention).

---

## Ground rules for the cleanup task

1. **Don't touch `/mobile` or `/expo`.** Per CLAUDE.md hard rule #2.
2. **Re-grep before every delete.** This doc was greped 2026-05-12; state may have changed by cleanup time.
3. **One migration per logical group.** Don't try to drop 12 tables in one file.
4. **Tag each cleanup migration in its header comment** as `LEGACY_CLEANUP` so future readers know it's intentional dead-code removal, not part of the active feature ladder.
5. **No DROPs against the shared mobile schema.** Anything that `/mobile` reads — even if v1 doesn't — stays until v3 mobile is rebooted.
