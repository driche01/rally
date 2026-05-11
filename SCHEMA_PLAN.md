# Schema Plan — Phase A

**Generated:** 2026-05-11
**Reads from:** `SCHEMA_REPORT.md` + `docs/rally_phase_a_build_guide.md` §4
**Open dependencies:** `BUILD_QUESTIONS.md` Q1–Q6 must be RESOLVED before this plan executes.
**Status:** Q1–Q7 RESOLVED 2026-05-11. Q5 resolved with a revised approach (reuse `thread_messages`, drop `sms_messages`). Section 7 below reflects the revision.

> **NOTHING IN THIS FILE HAS BEEN EXECUTED.** All DDL below is a preview. Per CLAUDE.md hard rule #3, this file waits for human approval. Migrations land only after sign-off. The Design Gate (build guide §5) is the next hard stop before migrations run.

This plan assumes the recommendations in `BUILD_QUESTIONS.md` are accepted. If you choose different options, the DDL below changes accordingly and I'll regenerate.

---

## 0. Migration numbering

- Current head in repo (worktree): `113_respondent_note.sql`.
- Current head applied to prod: `114_drop_paywall_artifacts.sql` (file uncommitted in parent).
- Local-only unapplied file: `115_trip_nudge_overrides.sql` (untracked in parent).

**Phase A migrations will start at `116`** to leave room for 114/115 to be committed/applied first. Filenames will follow the existing `NNN_snake_case.sql` convention.

Phase A migrations (proposed):
- `116_phase_a_trips_extend.sql`
- `117_phase_a_traveler_profiles_vibe_columns.sql`
- `118_phase_a_respondents_invitation_fields.sql`
- `119_phase_a_trip_cohosts.sql`
- `120_phase_a_activity_feed_entries.sql`
- `121_phase_a_mutuals.sql`
- `122_phase_a_thread_messages_extend.sql` *(revised per Q5 resolution — was `sms_messages`)*

Each migration is independently rerunnable (uses `IF NOT EXISTS` / idempotent guards).

---

## 1. `trips` — additive extend
**File:** `116_phase_a_trips_extend.sql`
**Phase A needs:** theme (template choice), cover_image_url, description, is_public, budget_min, budget_max.
**Existing columns we keep:** all 30 current columns including `budget_per_person` (text bucket), `destination`, `start_date`, `end_date`, `share_token`, `status`. None are touched.
**Note on budget:** existing `budget_per_person` (text) co-exists with new numeric `budget_min`/`budget_max`. Application code writes the new columns; legacy code that reads `budget_per_person` continues to work.

```sql
-- ============================================================
-- Migration 116: Phase A — extend trips with invitation-page fields
--
-- Adds Partiful-style invitation page metadata to trips. All
-- additive; existing columns and constraints are untouched.
-- ============================================================

ALTER TABLE trips
  ADD COLUMN IF NOT EXISTS theme            text,
  ADD COLUMN IF NOT EXISTS cover_image_url  text,
  ADD COLUMN IF NOT EXISTS description      text,
  ADD COLUMN IF NOT EXISTS is_public        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS budget_min       numeric,
  ADD COLUMN IF NOT EXISTS budget_max       numeric;

-- Constrain `theme` to the six Partiful-style template choices.
-- Nullable so legacy trips (which have no theme) stay valid.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'trips_theme_check'
  ) THEN
    ALTER TABLE trips
      ADD CONSTRAINT trips_theme_check
      CHECK (theme IS NULL OR theme IN (
        'classic','eclectic','fancy','literary','digital','elegant'
      ));
  END IF;
END$$;

-- Budget sanity: min <= max when both present.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'trips_budget_range_check'
  ) THEN
    ALTER TABLE trips
      ADD CONSTRAINT trips_budget_range_check
      CHECK (
        budget_min IS NULL OR budget_max IS NULL OR budget_min <= budget_max
      );
  END IF;
END$$;

-- Cover image: cap URL length defensively.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'trips_cover_image_url_len'
  ) THEN
    ALTER TABLE trips
      ADD CONSTRAINT trips_cover_image_url_len
      CHECK (cover_image_url IS NULL OR char_length(cover_image_url) <= 2048);
  END IF;
END$$;
```

**RLS:** no policy changes needed. Existing `trips` policies already allow planner read/write and anon read via share token.

---

## 2. `traveler_profiles` — additive vibe columns
**File:** `117_phase_a_traveler_profiles_vibe_columns.sql`
**Depends on:** Q2 resolved as Option A (reuse `traveler_profiles`).

```sql
-- ============================================================
-- Migration 117: Phase A — vibe questions on traveler_profiles
--
-- Adds the Tinder-style vibe question outputs to the existing
-- traveler_profiles table. PK stays on phone. user_id stays
-- nullable. Existing columns untouched.
--
-- Per BUILD_QUESTIONS.md Q2: one profile per phone, shared
-- between the Expo app and the Phase A web app. Phase A
-- backfills these columns on first RSVP; Expo writes the older
-- columns (sleep_pref etc.) as before.
-- ============================================================

ALTER TABLE traveler_profiles
  ADD COLUMN IF NOT EXISTS vibe_beach_or_mountain     text,
  ADD COLUMN IF NOT EXISTS vibe_spa_or_hike           text,
  ADD COLUMN IF NOT EXISTS vibe_foodie_or_casual      text,
  ADD COLUMN IF NOT EXISTS vibe_social_or_chill       text,
  ADD COLUMN IF NOT EXISTS vibe_culture_or_relaxation text,
  ADD COLUMN IF NOT EXISTS budget_comfort             text,
  ADD COLUMN IF NOT EXISTS vibe_captured_at           timestamptz;

-- Each vibe column: nullable (set null until the user completes
-- the capture flow), values constrained by CHECK.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'traveler_profiles_vibe_beach_or_mountain_check'
  ) THEN
    ALTER TABLE traveler_profiles
      ADD CONSTRAINT traveler_profiles_vibe_beach_or_mountain_check
      CHECK (vibe_beach_or_mountain IS NULL OR vibe_beach_or_mountain IN ('beach','mountain','both'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'traveler_profiles_vibe_spa_or_hike_check'
  ) THEN
    ALTER TABLE traveler_profiles
      ADD CONSTRAINT traveler_profiles_vibe_spa_or_hike_check
      CHECK (vibe_spa_or_hike IS NULL OR vibe_spa_or_hike IN ('spa','hike','both'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'traveler_profiles_vibe_foodie_or_casual_check'
  ) THEN
    ALTER TABLE traveler_profiles
      ADD CONSTRAINT traveler_profiles_vibe_foodie_or_casual_check
      CHECK (vibe_foodie_or_casual IS NULL OR vibe_foodie_or_casual IN ('foodie','casual','both'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'traveler_profiles_vibe_social_or_chill_check'
  ) THEN
    ALTER TABLE traveler_profiles
      ADD CONSTRAINT traveler_profiles_vibe_social_or_chill_check
      CHECK (vibe_social_or_chill IS NULL OR vibe_social_or_chill IN ('social','chill','both'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'traveler_profiles_vibe_culture_or_relaxation_check'
  ) THEN
    ALTER TABLE traveler_profiles
      ADD CONSTRAINT traveler_profiles_vibe_culture_or_relaxation_check
      CHECK (vibe_culture_or_relaxation IS NULL OR vibe_culture_or_relaxation IN ('culture','relaxation','both'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'traveler_profiles_budget_comfort_check'
  ) THEN
    ALTER TABLE traveler_profiles
      ADD CONSTRAINT traveler_profiles_budget_comfort_check
      CHECK (budget_comfort IS NULL OR budget_comfort IN ('budget','mid','premium','luxury'));
  END IF;
END$$;

-- Partial index for the "needs vibe capture?" query used by RSVP
-- gating. Tiny — most profiles will eventually have it set.
CREATE INDEX IF NOT EXISTS idx_traveler_profiles_needs_vibe_capture
  ON traveler_profiles (phone)
  WHERE vibe_beach_or_mountain IS NULL;
```

**RLS:** unchanged. Existing planner-read policy stays.

**Phase A behavior:** "First RSVP ever" = `traveler_profiles` row for this phone is missing OR has `vibe_captured_at IS NULL`. "One-tap confirm" = row exists AND `vibe_captured_at IS NOT NULL`.

---

## 3. `respondents` — Phase A invitation fields
**File:** `118_phase_a_respondents_invitation_fields.sql`
**Depends on:** Q3 resolved as Option C (reuse `respondents` for invitees, separate `trip_cohosts`).

```sql
-- ============================================================
-- Migration 118: Phase A — invitation/RSVP fields on respondents
--
-- The respondents table already represents trip invitees with
-- name/phone/email/user_id. Phase A adds the invitation
-- lifecycle state on top, additively.
--
-- The legacy `rsvp` column ('in'/'out') stays for the existing
-- Expo poll flow and is not touched. The new `rsvp_status`
-- column carries the Phase A invitation lifecycle.
-- ============================================================

ALTER TABLE respondents
  ADD COLUMN IF NOT EXISTS rsvp_status            text,
  ADD COLUMN IF NOT EXISTS rsvp_status_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS invited_by             uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS invited_at             timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'respondents_rsvp_status_check'
  ) THEN
    ALTER TABLE respondents
      ADD CONSTRAINT respondents_rsvp_status_check
      CHECK (rsvp_status IS NULL OR rsvp_status IN ('invited','going','maybe','cant_go'));
  END IF;
END$$;

-- At least one of (user_id, phone, email) must be non-null —
-- mirrors the build guide's invariant. Existing rows all satisfy
-- this (name is NOT NULL plus either phone or email or user_id),
-- so this is safe to add.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'respondents_identity_required'
  ) THEN
    ALTER TABLE respondents
      ADD CONSTRAINT respondents_identity_required
      CHECK (user_id IS NOT NULL OR phone IS NOT NULL OR email IS NOT NULL);
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_respondents_trip_rsvp_status
  ON respondents (trip_id, rsvp_status);
CREATE INDEX IF NOT EXISTS idx_respondents_invited_at
  ON respondents (invited_at)
  WHERE rsvp_status = 'invited';
```

**RLS posture for the new columns:**
- The existing `respondents` table has "Anyone can read respondents" — wide-open SELECT. That posture is fine for the invitation page (guest list is intentionally public to anyone with the share link).
- INSERT is already gated to (a) "Anyone can insert a respondent" (public RSVP flow) and (b) "trip owner can insert respondents" (planner-initiated invite). Both paths can write `rsvp_status`.
- UPDATE: existing "Session owner can update their respondent row" lets an invitee toggle their own RSVP. "trip owner can update respondents" lets the planner override on someone's behalf (Phase A requirement). Both are covered.
- No new policies required for this migration.

---

## 4. `trip_cohosts` — new
**File:** `119_phase_a_trip_cohosts.sql`
**Depends on:** Q1 (FK target for `user_id`). Recommendation says `profiles(id)` to match `trip_members`.

```sql
-- ============================================================
-- Migration 119: Phase A — trip_cohosts join table
--
-- Cohosts have full planner-equivalent permissions on a trip.
-- Composite PK (trip_id, user_id). FK to profiles to match the
-- existing trip_members convention.
-- ============================================================

CREATE TABLE IF NOT EXISTS trip_cohosts (
  trip_id    uuid        NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  user_id    uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  invited_by uuid                 REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (trip_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_trip_cohosts_user
  ON trip_cohosts (user_id);

ALTER TABLE trip_cohosts ENABLE ROW LEVEL SECURITY;

-- Planner can see their cohosts; cohosts can see themselves.
CREATE POLICY trip_cohosts_select
  ON trip_cohosts FOR SELECT
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM trips t
      WHERE t.id = trip_cohosts.trip_id
        AND t.created_by = auth.uid()
    )
  );

-- Only the planner can grant cohost.
CREATE POLICY trip_cohosts_insert
  ON trip_cohosts FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM trips t
      WHERE t.id = trip_cohosts.trip_id
        AND t.created_by = auth.uid()
    )
  );

-- Only the planner can revoke cohost (or a cohost can step
-- themselves down).
CREATE POLICY trip_cohosts_delete
  ON trip_cohosts FOR DELETE
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM trips t
      WHERE t.id = trip_cohosts.trip_id
        AND t.created_by = auth.uid()
    )
  );
```

---

## 5. `activity_feed_entries` — new
**File:** `120_phase_a_activity_feed_entries.sql`
**Depends on:** Q4 confirmed (separate from `trip_audit_events`).

```sql
-- ============================================================
-- Migration 120: Phase A — public-facing activity feed entries
--
-- Lives on the invitation page. Anon SELECT under share-token
-- conditions, authed INSERT for comments, system entries auto-
-- posted on RSVP changes (trigger below).
--
-- Distinct from trip_audit_events (planner-only audit log).
-- Different audience, different RLS.
-- ============================================================

CREATE TABLE IF NOT EXISTS activity_feed_entries (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id     uuid        NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  user_id     uuid                 REFERENCES users(id) ON DELETE SET NULL,
  entry_type  text        NOT NULL,
  content     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT activity_feed_entries_entry_type_check
    CHECK (entry_type IN ('rsvp_update','comment','gif','photo','system','planner_post'))
);

CREATE INDEX IF NOT EXISTS idx_activity_feed_entries_trip_created
  ON activity_feed_entries (trip_id, created_at DESC);

ALTER TABLE activity_feed_entries ENABLE ROW LEVEL SECURITY;

-- Anyone with the trip's share token can read the feed (the
-- invitation page is publicly accessible by design). We don't
-- carry the token at row level; the trips.is_public check + the
-- anon-trip-read policy together mean the feed is visible to
-- the same audience as the trip itself.
CREATE POLICY activity_feed_entries_anon_select
  ON activity_feed_entries FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM trips t
      WHERE t.id = activity_feed_entries.trip_id
    )
  );
-- NOTE: this exists() check matches the existing anon-read
-- pattern on trips. If we want tighter scoping (e.g., reject
-- feed reads if trip.is_public = false unless authed), add a
-- second clause referencing trip.is_public and auth.role().
-- Flagged in BUILD_QUESTIONS Q4 for confirmation.

-- Authed users can post comments + GIFs to trips they're a
-- member of OR planning.
CREATE POLICY activity_feed_entries_member_insert
  ON activity_feed_entries FOR INSERT
  WITH CHECK (
    entry_type IN ('comment','gif','photo','planner_post')
    AND (
      EXISTS (
        SELECT 1 FROM trips t
        WHERE t.id = activity_feed_entries.trip_id
          AND t.created_by = auth.uid()
      )
      OR EXISTS (
        SELECT 1 FROM trip_cohosts c
        WHERE c.trip_id = activity_feed_entries.trip_id
          AND c.user_id = auth.uid()
      )
      OR auth_user_is_trip_member(activity_feed_entries.trip_id)
    )
  );

-- System entries (RSVP changes, etc.) are inserted by triggers
-- running with elevated rights, not by user roles. No INSERT
-- policy for 'system' / 'rsvp_update' entries from public roles.
```

**Trigger to auto-post RSVP updates** (will land alongside Step 9 of the build sequence, not Step 0; included here only as a forward reference — not part of the schema migration that runs at Step 0):
```sql
-- forward-reference only — NOT in the Step 0 migration
-- CREATE FUNCTION activity_feed_emit_rsvp_update() RETURNS trigger ...
-- CREATE TRIGGER trg_respondents_rsvp_to_feed
--   AFTER UPDATE OF rsvp_status ON respondents
--   FOR EACH ROW
--   WHEN (NEW.rsvp_status IS DISTINCT FROM OLD.rsvp_status)
--   EXECUTE FUNCTION activity_feed_emit_rsvp_update();
```

---

## 6. `mutuals` — new
**File:** `121_phase_a_mutuals.sql`
**Depends on:** Q1 (FK target for user_id / mutual_user_id). Recommendation: `users(id)` to match the phone-keyed social graph.

```sql
-- ============================================================
-- Migration 121: Phase A — mutuals (past trip-mates graph)
--
-- Materialized cache of "who I've traveled with." Populated
-- post-RSVP by a job that joins respondents across trips.
-- Composite PK on (user_id, mutual_user_id). Bidirectional
-- pairs are stored as two rows so the planner-side query
-- "people I've traveled with" is a single index lookup.
-- ============================================================

CREATE TABLE IF NOT EXISTS mutuals (
  user_id                    uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mutual_user_id             uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shared_trip_count          integer     NOT NULL DEFAULT 0,
  last_traveled_together_at  timestamptz,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, mutual_user_id),
  CONSTRAINT mutuals_not_self CHECK (user_id <> mutual_user_id),
  CONSTRAINT mutuals_shared_trip_count_nonneg CHECK (shared_trip_count >= 0)
);

CREATE INDEX IF NOT EXISTS idx_mutuals_user_count_desc
  ON mutuals (user_id, shared_trip_count DESC);

ALTER TABLE mutuals ENABLE ROW LEVEL SECURITY;

-- A user can read their own mutuals row (for the invite picker).
CREATE POLICY mutuals_self_select
  ON mutuals FOR SELECT
  USING (
    user_id = (SELECT u.id FROM users u WHERE u.auth_user_id = auth.uid())
  );

-- No INSERT / UPDATE / DELETE policies for public roles. The
-- mutuals job runs as service_role and bypasses RLS. (Mutual
-- rows are derived, not user-edited.)
```

---

## 7. `thread_messages` — additive extend (revised per Q5)
**File:** `122_phase_a_thread_messages_extend.sql`
**Depends on:** Q5 resolved as reuse-`thread_messages`.
**Replaces:** the originally-planned `sms_messages` table. `thread_messages` is already the outbound send log used by `_sms-shared/dm-sender.ts` (`sendDm()` and `broadcast()`); it already carries `body`, `message_sid`, `delivery_status`, `error_code`, `direction`, `sender_phone`. We add the trip linkage Phase A needs and an indexed `message_type`.

```sql
-- ============================================================
-- Migration 122: Phase A — extend thread_messages for invitation rail
--
-- thread_messages is the existing outbound SMS log (used by the
-- 1:1 dm-sender.ts and the planner-blast broadcast() helper).
-- Phase A reuses it. Additive only:
--   1. trip_id: nullable FK to trips, so Phase A sends can bind
--      to a trip without needing a trip_session_id (which is
--      poll-cadence-specific).
--   2. message_type: nullable text, so we can distinguish
--      'rsvp_nudge' from legacy outbound send types without
--      changing how the existing flows tag their sends.
--   3. Partial index for the planner activity-log read path.
--
-- The existing trip_session_id stays for legacy sends. The new
-- trip_id is also nullable; rows can carry either, neither, or
-- (rare) both (during a transitional period when a legacy send
-- happens to know its trip too).
-- ============================================================

ALTER TABLE thread_messages
  ADD COLUMN IF NOT EXISTS trip_id      uuid REFERENCES trips(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS message_type text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'thread_messages_message_type_check'
  ) THEN
    ALTER TABLE thread_messages
      ADD CONSTRAINT thread_messages_message_type_check
      CHECK (
        message_type IS NULL OR message_type IN (
          'rsvp_nudge',
          'profile_completion',
          'booking_nudge',
          'pre_trip_summary',
          'planner_blast'
        )
      );
  END IF;
END$$;

-- Planner activity-log read path: "show me all outbound SMS for
-- this trip, newest first, optionally filtered by message_type."
CREATE INDEX IF NOT EXISTS idx_thread_messages_trip_type_created
  ON thread_messages (trip_id, message_type, created_at DESC)
  WHERE direction = 'outbound';

-- RSVP-nudge dedupe path: "did we already send an rsvp_nudge to
-- this phone for this trip in the last N hours?" — needed by the
-- scheduler so we don't double-send.
CREATE INDEX IF NOT EXISTS idx_thread_messages_rsvp_nudge_dedupe
  ON thread_messages (trip_id, sender_phone, created_at DESC)
  WHERE direction = 'outbound' AND message_type = 'rsvp_nudge';
```

**RLS:** `thread_messages` already has policies appropriate for the legacy SMS rail. Phase A reuses them unchanged. The new columns are covered by the existing row-level policies (they apply to the whole row regardless of which columns are referenced).

**Note on `nudge_sends`:** unused for Phase A. The legacy poll-cadence engine continues to use it. Phase A's RSVP nudge scheduler queries `respondents` for state and `thread_messages` for "already sent?" — no schedule table is needed for a single nudge type.

---

## 8. `users.default_travel_profile_id` — **NOT** added (deviates from spec)

The Phase A build guide §4 instructs to add `default_travel_profile_id` to `users`. **My plan deviates from this** based on `BUILD_QUESTIONS.md` Q2: since the recommendation is to reuse `traveler_profiles` (PK'd on `phone`), and there's exactly one profile per phone, a "default profile" concept is meaningless. Phase A resolves a user's profile by joining `users.phone → traveler_profiles.phone`. The build guide's `default_travel_profile_id` column is dropped from the plan.

If you'd rather keep the column anyway (e.g., to future-proof for per-trip profile overrides), I'll add:
```sql
-- only if you want to keep the spec literal:
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS default_travel_profile_phone text REFERENCES traveler_profiles(phone) ON DELETE SET NULL;
```
…using the `phone` PK as the FK target. Awaiting your call.

---

## 9. What this plan does NOT do

- **No DROPs, no RENAMEs, no column type changes, no NOT NULL toggles on existing columns.** Everything is `ADD COLUMN IF NOT EXISTS` or new tables/indexes.
- **No changes to existing RLS policies** (only new policies on new tables). Existing policies on `trips`, `respondents`, etc. are untouched.
- **No new functions or triggers in Step 0.** The activity-feed auto-post trigger is forward-referenced in §5 above but ships at Step 9 of the Phase A build sequence, not Step 0.
- **No data migration / backfill.** No existing row needs to be modified. New columns default to NULL or `false`; new tables start empty.
- **No edge function changes.** Q7 (RSVP nudge implementation) affects Step 8, not the schema.
- **No touch to migration 114 or 115.** They are flagged in `SCHEMA_REPORT.md` §8; I recommend committing 114 and resolving 115 separately before Phase A migrations land, but that's a separate action.

---

## 10. Execution checklist (after approval)

When `BUILD_QUESTIONS.md` Q1–Q6 are RESOLVED and you sign off on this plan:

1. Reconcile migrations 114/115 (commit 114 to repo, decide on 115).
2. Write the seven migration files in `supabase/migrations/` numbered 116–122.
3. Run each `supabase db query --linked --file ...` (or via `supabase db push` if we restore docker), starting at 116.
4. After each migration, re-query `information_schema` to confirm the new columns/tables/constraints exist.
5. Update `SCHEMA_REPORT.md` to reflect the post-migration state.
6. Commit migrations + updated report + this plan + `BUILD_QUESTIONS.md` together.

Step 0 ends at "approval." Step 1 of §6 in the build guide picks up here.
