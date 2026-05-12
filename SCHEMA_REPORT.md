# Rally — Schema Report (Phase B, Step 0)

**Generated:** 2026-05-12
**Source:** live Supabase Postgres 17.6, project ref `qxpbnixvjtwckuedlrfj` (Rally, East US)
**Method:** `supabase db query --linked` against `information_schema`, `pg_catalog`, `pg_tables`, `pg_policies`, `pg_indexes`, `pg_stat_user_tables`
**Migration head applied to prod:** `134_phase_b_generation_log.sql` *(was 124 pre-Phase-B Step 1; Phase B migrations 125–134 applied 2026-05-12)*
**Migration head in committed repo (worktree):** `134_phase_b_generation_log.sql`

> Per CLAUDE.md hard rule #1: additive only. The Phase B plan in `SCHEMA_PLAN.md` adds columns and tables; it never drops, renames, or alters existing structures.

> This file is overwritten each phase (per the working agreement). The Phase A inventory still lives in git history at commit `49fa9a8`'s `SCHEMA_REPORT.md`.

---

## 1. Inventory summary (post-Phase-A)

- **Tables:** 38 (+3 vs pre-Phase-A: trip_cohosts, activity_feed_entries, mutuals)
- **Migration heads applied:** 116–124 (Phase A's 9 additive migrations + the trip-covers storage bucket)
- **Enum types in `public`:** 0 — convention remains `text + CHECK`
- **Storage buckets:** `avatars` (existing) + `trip-covers` (Phase A iteration, public)
- **Triggers added by Phase A:** `trg_phase_a_mutuals_on_respondent_change` (fires on respondents.rsvp_status → 'going')

---

## 2. Tables Phase B touches

### Hard collisions to extend (additive only)

| Table | Live row count | Phase B action |
|---|---|---|
| `lodging_options` | 0 | Extend additively per Q10: add `room_layout jsonb`, `ai_suggested boolean`, widen `status` CHECK |
| `itinerary_blocks` | 73 | Extend additively per Q11: add `ai_generated`, `created_by`, `location_url`; widen `type` CHECK |
| `lodging_votes` | 0 | Extend additively per Q12: add `vote text` with default `'yes'` |

The two-out-of-three with zero live rows means the risk of breaking the existing Expo path is functionally zero — the columns we're adding will be filled by Phase B, and any backfill of existing rows is the default value.

`itinerary_blocks` has 73 live rows from the Expo flow; Phase A's reality is that the planner-side Expo itinerary editor is the only writer (per memory: "the day-RSVP UI on the public respond page was deleted; itinerary_blocks back the still-live planner-side itinerary editor"). Adding new nullable columns is safe — Expo doesn't reference them, Phase B does.

### Existing tables Phase B reads but does not modify

| Table | Read-by-Phase-B for |
|---|---|
| `trips` | trip metadata + theme + cover_image_url for the flyer |
| `respondents` | "going members" filter + per-member voting/assignment FK target (Q13) |
| `traveler_profiles` | profile aggregation engine input |
| `users` | name/phone resolution when invitees authenticate |
| `profiles` | planner identity, cohost identity |
| `trip_cohosts` | who else can generate AI plans / select lodging / etc. |
| `activity_feed_entries` | emit system entries when AI plans land |
| `mutuals` | Step 10 — past-trip-mates filter/sort/search |
| `thread_messages` | optional SMS sends (e.g., "voting closes tomorrow" planner nudges) |
| `trip_travel_legs` | NOT touched — Expo's per-respondent travel legs. Phase B builds new `travel_arrangements`. |

### New tables Phase B creates

12 new tables. All additive, all empty at start. See `SCHEMA_PLAN.md` for the DDL.

- `itinerary_item_votes` — per-`itinerary_blocks` row yes/no/maybe per `respondents.id`
- `itinerary_item_alternatives` — "vote between A or B" group containers
- `itinerary_alternative_options` — many-to-many between alternatives and items
- `lodging_room_assignments` — who's in which room, what they owe
- `travel_arrangements` — per-`respondents` flight / drive / etc.
- `travel_groupings` — shared rides, by driver + departure time
- `travel_grouping_members` — many-to-many between groupings and members
- `meals` — per-day per-meal-type plan entries
- `meal_ingredients` — normalized ingredients for cook-in meals
- `meal_votes` — yes/no/maybe on each meal
- `shopping_list_items` — derived from meal_ingredients, aggregated + categorized
- `trip_flyers` — generated flyer records (per template + cover combination)
- `phase_b_generation_log` — AI cost / token tracking (my §7 addition; not in build guide but recommended)

---

## 3. Identity model (unchanged from Phase A)

- `auth.users` → keyed by `auth.uid()`; managed by Supabase Auth
- `public.profiles` (4 rows) → mirrors `auth.users` 1:1; holds name, email, phone, avatar
- `public.users` (10 rows) → Rally identity; phone-primary; may lack auth (`auth_user_id` is nullable)
- `public.respondents` (8 rows) → invitees per trip; may lack auth; **the primary per-trip-member entity for Phase B**

**Phase B's FK rule (per Q13):** per-member tables FK to `respondents(id)`. The Phase B build guide originally said `users(id)`; Q13 corrects this so invitees without Rally auth accounts can still vote, get assigned rooms, fill in travel, etc. — gated by `respondents.session_token` for anon callers, `auth.uid() → users.id → respondents.user_id` for authed callers.

The one exception is `itinerary_blocks.created_by` — that's "who created this item." For AI-generated items it's NULL; for planner-created items it's the planner's `respondents.id` (every planner is also a respondent to their own trip — confirmed by `respondents.is_planner=true` flag).

---

## 4. RLS posture for Phase B's new tables

All Phase B tables go through the same pattern as Phase A:
- **Anon reads** for the invitee-facing surfaces (votes, lodging options, meals, etc. when read via the share token)
- **Service-role writes** for any vote/assignment/etc. coming from anon (gated by session_token at the API layer)
- **Planner/cohost writes** for the "generate AI plan" actions (gated via `requireAuthUid()` + `trips.created_by = auth.uid() OR trip_cohosts entry`)

Phase B SCHEMA_PLAN spells out the policies per table.

---

## 5. Pre-Phase-B reality checks

- Migration 115 (`trip_nudge_overrides`) is still staged locally + not applied. Phase B doesn't depend on it.
- Migration 114 is still uncommitted in the parent checkout. Phase B doesn't depend on it but recommend committing alongside Phase B's migrations.
- `sms-rsvp-nudge-scheduler` edge function is still not deployed. Phase A scope; Phase B doesn't depend on it.
- Cover image upload + Gemini generate are live + working. The flyer step in Phase B can reuse the storage bucket (`trip-covers`) and the upload route pattern.
- Themes v2 propagate through the invite page + planner dashboard. The flyer step should consume the theme to keep visual consistency.

---

## 6. Open dependencies

None block schema execution. Q10–Q17 in `BUILD_QUESTIONS.md` are all RESOLVED 2026-05-12. The schema plan in `SCHEMA_PLAN.md` reflects every Phase B decision.

---

## 7. Post-migration state (Phase B Step 1 — applied 2026-05-12)

All 10 Phase B migrations landed cleanly against the live DB.

**New tables (13):**
- `itinerary_item_votes`, `itinerary_item_alternatives`, `itinerary_alternative_options` *(voting + A-vs-B groupings on itinerary_blocks)*
- `lodging_room_assignments`
- `travel_arrangements`, `travel_groupings`, `travel_grouping_members`
- `meals`, `meal_ingredients`, `meal_votes`
- `shopping_list_items`
- `trip_flyers`
- `phase_b_generation_log` *(AI cost tracking; §7 addition)*

**Extended tables (3):**
- `lodging_options`: +2 columns (`room_layout jsonb`, `ai_suggested bool`); status CHECK widened to `{option, selected, rejected, booked}`. Zero live rows pre-migration → zero data risk.
- `itinerary_blocks`: +3 columns (`ai_generated bool`, `created_by uuid → respondents`, `location_url text`); new type CHECK covering both the Expo set `{accommodation, activity, free_time, meal, travel}` and the Phase B canonical set `{activity, meal, transit, lodging, free_time, other}`. 73 live rows pre-migration — all preserved.
- `lodging_votes`: +1 column (`vote text default 'yes'` with CHECK yes/no/maybe). Zero live rows. Added UNIQUE on `(lodging_option_id, respondent_id)`.

**By the numbers:**
- 15 new CHECK constraints
- 17 new indexes (including 1 unique on shopping_list_items and 1 unique on lodging_votes)
- 12 new RLS policies (all SELECT, anon-readable under share-token gate)
- 10 new rows in `supabase_migrations.schema_migrations` (versions 125–134)

**Identity rule applied:** every per-member FK across the 13 new tables FKs `respondents(id)` per Q13 — `itinerary_item_votes.respondent_id`, `lodging_room_assignments.respondent_id`, `travel_arrangements.respondent_id`, `travel_groupings.driver_respondent_id`, `travel_grouping_members.respondent_id`, `meal_votes.respondent_id`, `meals.assigned_cook_respondent_ids[]`, `shopping_list_items.assigned_respondent_id`. The two exceptions are `itinerary_blocks.created_by` (FK respondents — added) and `trip_flyers.generated_by` / `phase_b_generation_log.caller_user_id` (FK `profiles(id)` — planner/cohost only, never anon).

**What was NOT touched:** no DROPs (except the controlled widening of `lodging_options_status_check` with zero live rows), no RENAMEs, no NOT NULL toggles, no changes to existing RLS or triggers. The Expo path is byte-for-byte intact except for the additive columns on `itinerary_blocks` (which Expo doesn't read).

> Same handshake as Phase A: `SCHEMA_PLAN.md` is a preview only. Migrations land only after human sign-off on the plan.
