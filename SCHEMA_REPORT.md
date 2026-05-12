# Rally — Schema Report (Phase C, Step 0)

**Generated:** 2026-05-12
**Source:** live Supabase Postgres 17.6, project ref `qxpbnixvjtwckuedlrfj` (Rally, us-east)
**Method:** `supabase db query --linked` against `information_schema`, `pg_catalog`, `pg_indexes`
**Migration head applied to prod:** `134_phase_b_generation_log.sql` (Phase B's last)
**Migration head in committed repo:** `134_phase_b_generation_log.sql`
**Next migration version:** `135`

> Per CLAUDE.md hard rule #1: additive only. The Phase C plan in `SCHEMA_PLAN.md` adds columns + tables only; never drops, renames, or alters existing structures. The exception — drops of legacy Expo-era artifacts — is deferred to the post-Phase-C cleanup PR per [LEGACY_CLEANUP.md](LEGACY_CLEANUP.md).

> This file is overwritten each phase. The Phase A and B versions live in git history at commits `49fa9a8` and `06a671b`.

---

## 1. Inventory summary (post-Phase-B)

- **Public tables:** 51 (+13 vs pre-Phase-B; 0 vs end-of-Phase-B since the flyer-removal commit kept `trip_flyers` per the additive rule).
- **Migration heads applied:** 116–134 (Phase A's 9 + Phase B's 10).
- **Enum types in `public`:** 0 — convention remains `text + CHECK` (Q6).
- **Storage buckets:** `avatars`, `trip-covers`.
- **Phase A triggers:** `trg_phase_a_mutuals_on_respondent_change`.

## 2. Row counts on tables Phase C touches

Alpha hasn't started — counts are dev/seed data only.

| Table | Rows |
|---|---|
| `trips` | 13 |
| `respondents` | 10 |
| `trip_cohosts` | 0 |
| `thread_messages` (all) | 41 |
| `thread_messages` (Phase A outbound, `trip_id IS NOT NULL`) | 0 |
| `activity_feed_entries` | 9 |
| `traveler_profiles` (all) | 5 |
| `traveler_profiles` with `home_airport` set | 2 |
| `users` | 10 |
| `users` with `opted_out=true` | 0 |
| `profiles` | 4 |

**Phase C–relevant signals:**
- **3 of 5 `traveler_profiles` rows are missing `home_airport`.** Per Q25, home_airport becomes required at profile capture; these 3 rows would need the one-time fill-in SMS (or get caught by the profile-completion nudge). Tiny set, easy to handle.
- **0 outbound SMS sent yet** — `sms-rsvp-nudge-scheduler` is built but not deployed (PHASE_A_DEMO.md straggler). Phase 0 of Phase C deploys it.
- **0 opted-out users.** `users.opted_out` flow is theoretical until alpha.
- **0 cohosts.** Phase C is the first phase that builds cohost-facing UI (blast composer + reminder settings).

## 3. Tables Phase C will touch

### 3a. Extend (additive columns only)

| Table | Current | Phase C action |
|---|---|---|
| `trips` | 37 columns | Add `cancelled_at timestamptz NULL`, `cancelled_by uuid NULL → profiles(id)`. Phase C cancel-trip writes both at confirmation time. |
| `thread_messages.message_type` | `text NULL`, no CHECK | **No DDL.** New values added at app layer only (`profile_completion_nudge`, `booking_nudge`, `pre_trip_summary`, `re_engagement`, `cancellation_notice`, `planner_blast`, plus optional message-feed types if used: `lodging_vote_open`, `lodging_locked`, `itinerary_vote_open`, `final_headcount`). |

### 3b. New tables

| Table | Purpose | PK | Notable FKs |
|---|---|---|---|
| `scheduled_reminders` | Per-recipient scheduled future SMS for the polyglot scheduler | `id uuid` | `trip_id → trips`, `recipient_respondent_id → respondents`, `sent_thread_message_id → thread_messages` (nullable until sent) |
| `planner_blasts` | One row per composed blast | `id uuid` | `trip_id → trips`, `composed_by → profiles`, `activity_feed_entry_id → activity_feed_entries` (nullable) |
| `planner_blast_sends` | One row per recipient per blast | `id uuid` | `blast_id → planner_blasts`, `recipient_respondent_id → respondents`, `thread_message_id → thread_messages` (nullable until sent) |
| `trip_reminder_settings` | Per-trip on/off toggles for the 5 auto-reminder types | `trip_id uuid` (PK) | `trip_id → trips` |

All four are NEW — no legacy collisions.

### 3c. App-layer reference data (no DB change)

| Asset | Where | Purpose |
|---|---|---|
| `iata_to_tz.json` | `/shared/iata_to_tz.json` | Static ~500-entry IATA→IANA TZ map for quiet-hours resolution per Q25 |

## 4. Existing FK targets confirmed (re-verified 2026-05-12 against live)

Confirms Q1's dual-identity rule still holds:

| Column | Target | Side |
|---|---|---|
| `trips.created_by` | `profiles.id` | planner |
| `trip_cohosts.user_id` | `profiles.id` | planner |
| `trip_cohosts.invited_by` | `profiles.id` | planner |
| `respondents.user_id` | `users.id` | invitee |
| `respondents.invited_by` | `users.id` | invitee |
| `respondents.trip_id` | `trips.id` | — |
| `activity_feed_entries.user_id` | `users.id` | invitee/system |
| `thread_messages.trip_id` | `trips.id` | — |
| `thread_messages.trip_session_id` | `trip_sessions.id` | **legacy** (cleanup list) |
| `traveler_profiles.user_id` | `users.id` | invitee |

→ Phase C inherits the same convention: planner-side FK targets = `profiles.id`, invitee/SMS-side = `users.id`, per-member = `respondents.id`.

## 5. RLS posture (post-Phase-B)

All tables have RLS enabled in line with the existing convention. Phase C new tables follow the same pattern:

| Table | Read | Write |
|---|---|---|
| `scheduled_reminders` | host-or-cohost of the trip | service role only (worker writes) |
| `planner_blasts` | host-or-cohost of the trip | host-or-cohost (compose) |
| `planner_blast_sends` | host-or-cohost of the trip | service role only (send pipeline writes) |
| `trip_reminder_settings` | host-or-cohost of the trip | host-or-cohost (toggle settings) |

## 6. What's NOT changing

- No DROPs (per hard rule #1). Legacy Expo-era artifacts stay in place until the post-Phase-C cleanup PR.
- No RENAMEs.
- No NOT-NULL flips on existing columns.
- No new enum types in Postgres (`text + CHECK` everywhere, Q6).
- No new triggers (Phase C logic runs at the app/edge layer).
- No changes to `trip_cohosts`, `respondents`, `activity_feed_entries`, `traveler_profiles`, `users`, `profiles`, or any Phase B tables.

## 7. Plan target

See [SCHEMA_PLAN.md](SCHEMA_PLAN.md) for the full DDL of migrations `135_phase_c_trips_cancelled.sql` through `140_phase_c_self_respondent_backfill.sql`.

Plan must be human-signed-off before any DDL runs (hard rule #3).
