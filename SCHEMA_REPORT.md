# Rally — Schema Report (Phase A, Step 0)

**Generated:** 2026-05-11
**Source:** live Supabase Postgres 17.6, project ref `qxpbnixvjtwckuedlrfj` (Rally, East US)
**Method:** `supabase db query --linked` against `information_schema`, `pg_catalog`, `pg_tables`, `pg_policies`, `pg_indexes`
**Migration head applied to prod:** `122_phase_a_thread_messages_extend.sql` *(was 114 at Step 0; Phase A migrations 116–122 applied 2026-05-11)*
**Migration head in committed repo (worktree):** `122_phase_a_thread_messages_extend.sql`
**Migration head present locally but unapplied:** `115_trip_nudge_overrides.sql` (still uncommitted in parent checkout, still not applied; reconcile separately)

---

## 0. Post-migration update (Phase A Step 1 — applied 2026-05-11)

All seven Phase A migrations landed cleanly. The pre-migration inventory below is preserved as the "before" snapshot. New schema state in summary:

**New tables (3):**
- `trip_cohosts` — composite PK (trip_id, user_id → profiles), RLS on, 3 policies
- `activity_feed_entries` — uuid PK, FK to trips + users, RLS on, 2 policies
- `mutuals` — composite PK (user_id, mutual_user_id → users), RLS on, 1 policy

**Extended tables (4):**
- `trips`: +6 columns (`theme`, `cover_image_url`, `description`, `is_public`, `budget_min`, `budget_max`) + 3 CHECK constraints
- `traveler_profiles`: +7 columns (5 `vibe_*`, `budget_comfort`, `vibe_captured_at`) + 6 CHECK constraints + 1 partial index
- `respondents`: +4 columns (`rsvp_status`, `rsvp_status_updated_at`, `invited_by`, `invited_at`) + 2 CHECK constraints + 2 indexes
- `thread_messages`: +2 columns (`trip_id`, `message_type`) + 1 CHECK constraint + 2 partial indexes

**Tracking:** all 7 new rows in `supabase_migrations.schema_migrations` (versions 116–122). Self-registered by each migration file's footer INSERT (using `ON CONFLICT (version) DO NOTHING`) since we applied via `supabase db query --linked` rather than `db push` (docker not running for push). This is safe to reconcile later when push runs — the tracking rows are already present so push will skip them.

**What was NOT touched** (still true): no DROPs, no RENAMEs, no NOT NULL toggles, no changes to existing RLS policies or triggers. The pre-Phase-A schema below is preserved 100%.

**Audit query used to verify** (kept for re-run during Phase B Step 0):
```sql
-- 27 expected items: 3 tables + 6 trips_cols + 7 traveler_profiles_cols
-- + 4 respondents_cols + 2 thread_messages_cols + 7 migration rows.
-- Plus 8 indexes + 11 CHECK constraints + 6 RLS policies in a separate query.
```

---

> Per CLAUDE.md hard rule #1: no DROPs, no RENAMEs, no destructive ALTERs against any column listed below. Phase A schema evolution is additive only.

---

## 1. Inventory summary

- **Schemas inspected:** `public`
- **Tables:** 35
- **Columns:** 387
- **Constraints (PK/FK/UNIQUE/CHECK/NOT NULL):** 358
- **Indexes:** 109
- **RLS policies:** 160
- **Triggers:** 38
- **Functions in `public`:** 59
- **Enum types in `public`:** 0 — the codebase models enums as `text` + `CHECK (col IN (...))`. Phase A must follow the same convention.

---

## 2. Identity model — the most important context for Phase A

Rally already has a **dual-table identity model** that the Phase A build guide does not anticipate. Three identity tables exist:

| Table | Keyed by | Purpose | FK target for... |
|---|---|---|---|
| `auth.users` | `id` (uuid) | Supabase Auth principal | `profiles.id`, `users.auth_user_id` |
| `public.profiles` | `id` = `auth.uid()` | Auth-side mirror; name/email/phone/avatar | `trips.created_by`, `trip_members.user_id`, `conversation_members.profile_id`, etc. |
| `public.users` | `id` (Rally-internal uuid) | Rally identity (phone-primary, may lack auth) | `respondents.user_id`, `traveler_profiles.user_id`, `trip_audit_events.actor_id`, `push_tokens.user_id`, etc. |

Key consequences for Phase A:

1. **"user" is ambiguous.** Every FK to "a user" in the Phase A spec must resolve to either `profiles.id` or `users.id`. The existing codebase splits roughly along this line:
   - **Authed-only paths** (planner dashboard, trip ownership, conversation membership) FK to `profiles.id`.
   - **Phone-first / pre-account paths** (respondent invites, traveler profile, audit actor, SMS recipient) FK to `users.id`, which itself optionally links to `auth.users` via `users.auth_user_id`.
2. **Phase A's mental model is "one users table."** It isn't, and trying to flatten the two will violate hard rule #1.
3. **The Phase A invitation flow is a pre-account path.** Invitees may have no Supabase Auth row, no `profiles` row, and no Rally `users` row at invitation time. Phase A's invitee FKs should land on `public.users` (with `users.auth_user_id` filling in after they sign up), matching how `respondents.user_id` works today.
4. **Trip authorship FKs go to `profiles.id`.** `trips.created_by` already FKs `profiles(id)`. Phase A must not change this; planner identity flows through the auth-side table.

See `BUILD_QUESTIONS.md` Q1 for the canonical decision on which table each Phase A FK resolves to.

---

## 3. Phase A overlap quick reference

| Phase A wants | Existing analog | Verdict | Notes |
|---|---|---|---|
| `trips` (new) | `trips` (42 col, 6 rows) | **EXTEND additively** | Has dates, destination, budget_per_person, share_token, status, form_draft. Missing: `theme`, `cover_image_url`, `description`, `is_public`, `budget_min`, `budget_max`. |
| `users.default_travel_profile_id` FK | `users` + `traveler_profiles` (phone-keyed!) | **AWAITING DECISION** (Q2) | Phase A spec assumes `travel_profiles.id` exists; existing `traveler_profiles` is PK'd on `phone`. |
| `trip_cohosts` (new) | nothing | **CREATE** | No overlap. |
| `trip_memberships` (new) | `respondents` (12 col) + `trip_members` (5 col) | **AWAITING DECISION** (Q3) | `respondents` covers pre-account invitees with phone/email/name/RSVP. `trip_members` covers authed-account joins. The Phase A spec collapses these into one table. |
| `travel_profiles` (new) | `traveler_profiles` (19 col) | **AWAITING DECISION** (Q2) | Existing table is PK'd on `phone` (not user_id), has 16 lifestyle columns from the Expo app. Phase A spec wants id/user_id PK with vibe_* columns. |
| `activity_feed_entries` (new) | `trip_audit_events` (6 col, planner-only RLS) | **CREATE NEW** | Different audience: feed is invitee-facing, audit is planner-only. Recommend separate table. (Q4) |
| `mutuals` (new) | nothing | **CREATE** | No overlap. |
| `sms_messages` (new) | `nudge_sends` (10 col, tied to `trip_sessions`) | **CREATE NEW** (recommend) | `nudge_sends` is tightly coupled to the legacy poll-cadence engine via `trip_session_id`. New table is cleaner. (Q5) |

---

## 4. Full table inventory

### Tables flagged for Phase A interaction

#### `trips` (6 rows)

| # | Column | Type | Null | Default |
|---|---|---|---|---|
| 1 | id | uuid | NO | `gen_random_uuid()` |
| 2 | created_by | uuid | YES | — |
| 3 | name | text | NO | — |
| 4 | group_size_bucket | text | NO | — |
| 5 | travel_window | text | YES | — |
| 6 | share_token | text | NO | `encode(gen_random_bytes(12),'hex')` |
| 7 | status | text | NO | `'active'` |
| 8 | created_at | timestamptz | NO | `now()` |
| 9 | updated_at | timestamptz | NO | `now()` |
| 10 | group_size_precise | int4 | YES | — |
| 23 | trip_type | text | YES | — |
| 24 | budget_per_person | text | YES | — |
| 25 | start_date | date | YES | — |
| 26 | end_date | date | YES | — |
| 27 | destination | text | YES | — |
| 28 | destination_address | text | YES | — |
| 29 | trip_duration | text | YES | — |
| 30 | book_by_date | date | YES | — |
| 31 | responses_due_date | date | YES | — |
| 32 | custom_intro_sms | text | YES | — |
| 33 | finalize_prompt_sent_at | timestamptz | YES | — |
| 34 | stuck_alert_sent_at | timestamptz | YES | — |
| 35 | estimated_flight_cost_per_person | numeric | YES | — |
| 36 | cached_lodging_suggestions | jsonb | YES | — |
| 37 | cached_lodging_suggestions_signature | text | YES | — |
| 38 | cached_lodging_suggestions_updated_at | timestamptz | YES | — |
| 39 | cached_travel_suggestions | jsonb | YES | — |
| 40 | cached_travel_suggestions_signature | text | YES | — |
| 41 | cached_travel_suggestions_updated_at | timestamptz | YES | — |
| 42 | form_draft | jsonb | YES | — |

> Ordinal positions 11–22 are dropped slots (Phase 6 cleanup + 114). Nothing to recreate.

**Constraints:**
- PK `(id)`
- FK `created_by → profiles(id)`
- UNIQUE `(share_token)`
- CHECK `group_size_bucket IN ('0-4','5-8','9-12','13-20','20+')`
- CHECK `group_size_precise IS NULL OR (1..999)`
- CHECK `char_length(name) <= 60`
- CHECK `responses_due_date IS NULL OR book_by_date IS NULL OR responses_due_date <= book_by_date`
- CHECK `status IN ('active','closed','draft')` — note: per memory, `'closed'` is dead in code but still permitted by CHECK; TS narrowed to `'active'|'draft'`.

**Indexes:** `(id)` PK, `(created_by)`, `(share_token)` (unique + plain).

**RLS:** enabled. Policies:
- "Planners can create trips" — INSERT `created_by = auth.uid()`
- "Planners can manage their own trips" — ALL `auth.uid() = created_by`
- "Planners can read/update/delete their own trips" — three SELECT/UPDATE/DELETE variants
- "Authenticated users can read their own trips" — SELECT `auth.role()='authenticated' AND (auth.uid()=created_by OR auth_user_is_trip_member(id))`
- "Unauthenticated users can read trips via share link" — SELECT `auth.role()='anon'` (full row exposed to anon when they have the share token — invite-page-friendly).

---

#### `users` (10 rows)

| # | Column | Type | Null | Default |
|---|---|---|---|---|
| 1 | id | uuid | NO | `gen_random_uuid()` |
| 2 | phone | text | NO | — |
| 3 | display_name | text | YES | — |
| 4 | email | text | YES | — |
| 5 | rally_account | bool | YES | `false` |
| 6 | trip_count | int4 | YES | `0` |
| 7 | opted_out | bool | YES | `false` |
| 8 | created_at | timestamptz | YES | `now()` |
| 9 | updated_at | timestamptz | YES | `now()` |
| 10 | auth_user_id | uuid | YES | — |

**Constraints:** PK `(id)`, UNIQUE `(phone)`, UNIQUE `(email)`, FK `auth_user_id → auth.users(id)` (cross-schema).
**Indexes:** PK, `(phone)`, `(email)`, partial UNIQUE on `auth_user_id WHERE auth_user_id IS NOT NULL`.
**RLS:** enabled. "users_self_select" — `auth_user_id = auth.uid()`.

---

#### `profiles` (1 row)

| # | Column | Type | Null | Default |
|---|---|---|---|---|
| 1 | id | uuid | NO | — |
| 2 | name | text | NO | — |
| 3 | email | text | NO | — |
| 4 | created_at | timestamptz | NO | `now()` |
| 5 | last_name | text | YES | — |
| 6 | phone | text | YES | — |
| 7 | avatar_url | text | YES | — |

**Constraints:** PK `(id)`, UNIQUE `(email)`, FK `id → auth.users(id)`.
**RLS:** enabled. Self-read/update by `auth.uid()`, planner profiles readable to their trip members.

---

#### `traveler_profiles` (—)

| # | Column | Type | Null | Default |
|---|---|---|---|---|
| 1 | phone | text | NO | — |
| 2 | user_id | uuid | YES | — |
| 3 | home_airport | text | YES | — |
| 4 | travel_pref | text | YES | — |
| 5 | flight_dealbreakers | text[] | YES | `'{}'` |
| 6 | sleep_pref | text | YES | — |
| 7 | lodging_pref | text | YES | — |
| 8 | dietary_restrictions | text[] | YES | `'{}'` |
| 9 | dietary_specifics | text | YES | — |
| 10 | meal_pref | text | YES | — |
| 11 | drinking_pref | text | YES | — |
| 12 | physical_limitations | text[] | YES | `'{}'` |
| 13 | physical_specifics | text | YES | — |
| 14 | trip_pace | int4 | YES | — |
| 15 | activity_types | text[] | YES | `'{}'` |
| 16 | budget_posture | text | YES | — |
| 17 | notes | text | YES | — |
| 18 | created_at | timestamptz | NO | `now()` |
| 19 | updated_at | timestamptz | NO | `now()` |

**Constraints:** **PK `(phone)`** (not `id`, not `user_id`), FK `user_id → users(id)`, CHECK `trip_pace IN 1..4`.
**Indexes:** PK on `(phone)`, `(user_id)`.
**RLS:** enabled — "planners read profiles of their trip participants" + others (not fully enumerated here).

> **Important:** this table's PK is `phone`. Phase A's spec assumes a `(user_id)`-unique profile. Reconciliation question in BUILD_QUESTIONS.md Q2.

---

#### `respondents` (5 rows)

| # | Column | Type | Null | Default |
|---|---|---|---|---|
| 1 | id | uuid | NO | `gen_random_uuid()` |
| 2 | trip_id | uuid | NO | — |
| 3 | name | text | NO | — |
| 4 | session_token | text | NO | — |
| 5 | created_at | timestamptz | NO | `now()` |
| 6 | email | text | YES | — |
| 7 | phone | text | YES | — |
| 8 | is_planner | bool | NO | `false` |
| 9 | rsvp | text | YES | — |
| 10 | preferences | jsonb | YES | — |
| 11 | user_id | uuid | YES | — |
| 13 | note | text | YES | — |

**Constraints:**
- PK `(id)`
- FK `trip_id → trips(id)`
- FK `user_id → users(id)`
- UNIQUE `(trip_id, session_token)`
- CHECK `rsvp IN ('in','out')` — **this CHECK blocks Phase A's `{invited,going,maybe,cant_go}` values.** See Q3.
- CHECK `char_length(name) <= 30`
- CHECK `note IS NULL OR char_length(note) <= 280`

**Indexes:** PK, `(trip_id, phone)`, `(user_id)`, `(session_token)`, `(trip_id)`, UNIQUE `(trip_id, session_token)`.
**RLS:** very permissive — "Anyone can insert/read respondents" (used by the public respond/[tripId] page).

---

#### `trip_members` (2 rows)

| # | Column | Type | Null | Default |
|---|---|---|---|---|
| 1 | id | uuid | NO | `gen_random_uuid()` |
| 2 | trip_id | uuid | NO | — |
| 3 | user_id | uuid | **NO** | — |
| 4 | role | text | NO | `'member'` |
| 5 | joined_at | timestamptz | NO | `now()` |

**Constraints:** PK `(id)`, FK `trip_id → trips(id)`, **FK `user_id → profiles(id)`** (auth-side), UNIQUE `(trip_id, user_id)`, CHECK `role IN ('planner','member')`.
**Indexes:** PK, `(trip_id)`, `(user_id)`, UNIQUE `(trip_id, user_id)`.
**RLS:** enabled. Self-insert/select/delete by `auth.uid() = user_id`.

> **Important:** `user_id` is NOT NULL and FKs `profiles(id)`. This table is for authed Rally accounts; it cannot represent the pre-account invitee state Phase A's `trip_memberships` needs. See Q3.

---

#### `trip_audit_events` (18 rows)

| # | Column | Type | Null | Default |
|---|---|---|---|---|
| 1 | id | int8 | NO | sequence |
| 2 | trip_id | uuid | NO | — |
| 3 | actor_id | uuid | YES | — |
| 4 | kind | text | NO | — |
| 5 | payload | jsonb | NO | `'{}'` |
| 6 | created_at | timestamptz | NO | `now()` |

**Constraints:** PK `(id)`, FK `trip_id → trips(id)` (cascade), FK `actor_id → users(id)` (set null).
**Indexes:** PK, `(trip_id, created_at DESC)`.
**RLS:** enabled — **planner-only read** ("trip_audit_events_planner_read"): SELECT exists `trip_members` row with `role='planner'` for `auth.uid()`.

> Activity log for the planner dashboard (Phase 15 per memory). Not the public-facing invitee feed Phase A needs.

---

#### `nudge_sends` (47 rows)

| # | Column | Type | Null | Default |
|---|---|---|---|---|
| 1 | id | uuid | NO | `gen_random_uuid()` |
| 2 | trip_session_id | uuid | NO | — |
| 3 | participant_id | uuid | YES | — |
| 4 | nudge_type | text | NO | — |
| 5 | scheduled_for | timestamptz | NO | — |
| 6 | sent_at | timestamptz | YES | — |
| 7 | skipped_at | timestamptz | YES | — |
| 8 | skip_reason | text | YES | — |
| 9 | message_sid | text | YES | — |
| 10 | created_at | timestamptz | NO | `now()` |

**Constraints:** PK `(id)`, FK `trip_session_id → trip_sessions(id)` (NOT NULL — tightly coupled), FK `participant_id → trip_session_participants(id)`.
**Indexes:** PK, `(scheduled_for) WHERE sent IS NULL AND skipped IS NULL` (partial), `(participant_id, scheduled_for)`, `(trip_session_id, scheduled_for)`, partial UNIQUE on `(trip_session_id, participant_id, nudge_type) WHERE sent IS NULL AND skipped IS NULL`.

> Tightly coupled to the legacy `trip_sessions` poll-cadence engine. Body text is not stored here — it's regenerated at send time from cadence templates + `trip_nudge_overrides` (table not yet in prod). Phase A's `sms_messages` should be a separate table.

---

### Other existing tables (not in Phase A scope but listed for completeness)

| Table | Rough purpose |
|---|---|
| `agent_nudge_log` | Per-trip log of LLM agent nudges. |
| `ai_itinerary_options` | Phase 5+ cached AI itinerary drafts. Phase B will revisit. |
| `analytics_events` | PostHog-bound event log. |
| `beta_signups` | Email capture from landing page. |
| `conversations`, `conversation_members`, `conversation_messages`, `conversation_reactions` | Phase 2 chat (Expo app). Off-limits per hard rule #2. |
| `day_rsvps` | Per-day RSVP grid (Expo app). Per memory: data model lives but the planner UI is the only writer; the public day-RSVP UI was deleted. |
| `expenses`, `expense_splits` | Phase 2 expense tracking (Expo app). Off-limits. |
| `itinerary_blocks` | Planner-side itinerary editor (Expo app). Off-limits. |
| `lodging_options`, `lodging_votes` | Phase 2 lodging tracking. |
| `message_reactions`, `trip_messages`, `thread_messages` | Internal threads / SMS thread mirror. |
| `phone_claim_tokens`, `phone_login_tokens` | OTP infra for the existing auth flow. |
| `polls`, `poll_options`, `poll_responses`, `poll_recommendations` | Decision-engine MVP. |
| `push_tokens` | Expo push tokens (mobile only). |
| `trip_sessions`, `trip_session_participants` | Legacy 1:1 SMS poll cadence engine. |
| `trip_travel_legs` | Travel detail capture per respondent. |

These tables are not modified in Phase A. They are listed so future-phase work doesn't accidentally collide.

---

## 5. Triggers (38 total)

Notable trigger groups (full inventory in `/tmp/schema-inspect/triggers.csv` — not committed):

- **Activity log emitters** (Phase 15): `trip_audit_events` is populated by triggers on `trips`, `respondents`, `polls`, etc. (migrations 089–093). Per memory these are "trigger + app-code emit split."
- **Profile propagation** (migrations 095–097): `display_name` / full name propagation from `users` to `respondents` and `traveler_profiles` keyed by phone.
- **Lodging cache invalidation** (migrations 102, 104, 109): triggers on `traveler_profiles` updates invalidate cached lodging suggestions on `trips`.
- **Recommendation refresh** (migration 099): poll close triggers a refresh of pending recommendations.
- **`updated_at` touch triggers** on multiple tables.

Phase A must not modify any of these triggers. New triggers Phase A introduces should be on Phase A's new tables only.

---

## 6. Functions (59 total)

Selected by category:
- **SMS/cadence:** `set_planner_for_phone`, helpers around `trip_sessions`/`nudge_sends`.
- **Auth/account:** `auth_user_is_trip_member`, `account_exists_for_email`, `delete_account*`.
- **Recommendations:** `refresh_pending_recommendations` (+ related).
- **Audit triggers:** `trip_audit_*_trigger` functions for the activity log.
- **Touch-updated-at** standard `tg_*_touch_updated_at`.

Phase A should add new functions only for Phase A's new tables. Do not modify existing functions.

---

## 7. RLS posture (summary)

- **Every public-facing table has RLS enabled.** Confirmed for `trips`, `users`, `profiles`, `respondents`, `trip_members`, `traveler_profiles`, `trip_audit_events`, `nudge_sends`, etc.
- **Anon access is intentional on a few public surfaces:**
  - `trips`: anon SELECT via share token.
  - `respondents`: anon INSERT/SELECT (public respond page writes directly).
- **Planner-only tables** (`trip_audit_events`, `nudge_sends`) gate on `trip_members.role='planner'` for `auth.uid()`.
- **Phase A's new tables** will need RLS designed to match the invitation-first model: anon SELECT on the public invitation page, anon INSERT for first-time RSVPs (with token verification at the app layer), planner-only writes for cohost/roster management. See `SCHEMA_PLAN.md` for the policies that ship with each new table.

---

## 8. Migration history reconciliation

- **Committed to repo HEAD (worktree):** `001` through `113_respondent_note.sql` (113 files).
- **Applied to prod:** `001` through `114_drop_paywall_artifacts.sql`. Confirmed by absence of `trips.phase2_unlocked*` columns and absence of `discount_codes` / `discount_code_redemptions` tables.
- **Uncommitted in parent checkout (`/Users/davidriche/Rally/supabase/migrations/`):**
  - `114_drop_paywall_artifacts.sql` — applied to prod, file not committed. Suggest committing as a follow-up.
  - `115_trip_nudge_overrides.sql` — file present, **not applied to prod** (table absent from `pg_tables`). Suggest reconciling separately before Phase A migrations land, so the migration sequence is linear.

**Phase A migrations will be numbered starting at 116** to leave a clean slot for 114/115 if you choose to commit/apply them.

---

## 9. Items needing human decision before `SCHEMA_PLAN.md` is approved

See `BUILD_QUESTIONS.md`:
- Q1: Which identity table does each Phase A FK resolve to?
- Q2: Reuse `traveler_profiles` or create `travel_profiles`?
- Q3: Reuse `respondents`/`trip_members` or create `trip_memberships`?
- Q4: Confirm `activity_feed_entries` is a separate table from `trip_audit_events`.
- Q5: Confirm `sms_messages` is a separate table from `nudge_sends`.
- Q6: Enum representation: use existing convention (`text` + `CHECK`) rather than `CREATE TYPE ... AS ENUM`.

`SCHEMA_PLAN.md` proposes a working position on each but should not be executed until Q1–Q5 are RESOLVED.
