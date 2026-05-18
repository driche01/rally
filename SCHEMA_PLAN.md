# Schema Plan — Phase C

**Generated:** 2026-05-12
**Reads from:** `SCHEMA_REPORT.md` + `docs/rally_phase_c_build_guide.md` §3 + `BUILD_QUESTIONS.md` Q1, Q5, Q6, Q13 + `PHASE_C_PRE_BUILD_REVIEW.md` Q18–Q26
**Status:** Q18–Q26 RESOLVED 2026-05-12. **All DDL below is preview only — nothing has been executed.** Migrations land only after human sign-off on this file.

> Per CLAUDE.md hard rule #1: additive only. Zero DROPs, zero RENAMEs, zero NOT NULL flips on existing columns. Legacy Expo-era artifacts stay in place until the post-Phase-C cleanup PR per [LEGACY_CLEANUP.md](LEGACY_CLEANUP.md).
> Per hard rule #3: this file requires human sign-off before any migration runs.

---

## 1. Migrations at a glance

| # | Filename | Adds | Risk |
|---|---|---|---|
| 135 | `135_phase_c_trips_cancelled.sql` | `trips.cancelled_at`, `trips.cancelled_by`, partial-index for active trips | low — pure additive columns, nullable |
| 136 | `136_phase_c_scheduled_reminders.sql` | `scheduled_reminders` table + indexes + RLS | low — new table |
| 137 | `137_phase_c_planner_blasts.sql` | `planner_blasts` table + indexes + RLS | low — new table |
| 138 | `138_phase_c_planner_blast_sends.sql` | `planner_blast_sends` table + indexes + RLS | low — new table |
| 139 | `139_phase_c_trip_reminder_settings.sql` | `trip_reminder_settings` table + RLS | low — new table |
| 140 | `140_phase_c_self_respondent_backfill.sql` | One-time idempotent backfill of planner self-respondents (Q24) | low — INSERT … WHERE NOT EXISTS |

**Total live row impact:**
- New tables: 4 (zero rows at migration time)
- New columns: 2 on `trips` (both NULL)
- Backfill: up to 13 rows inserted into `respondents` (one per existing trip without a planner self-respondent — likely <13 since some test trips already have planner-as-respondent)

All migrations end with the standard `INSERT INTO supabase_migrations.schema_migrations` footer per existing convention.

---

## 2. Migration 135 — `trips.cancelled_at` + `cancelled_by`

```sql
-- ============================================================
-- Migration 135: Phase C — trip cancellation columns
--
-- Phase C ships the Cancel Trip flow (build guide §8, deferred
-- from Phase A). Setting cancelled_at locks the trip in a
-- "Cancelled" state; the API layer gates writes via
--   if (trip.cancelled_at) return 410 gone
-- (see PHASE_C_PRE_BUILD_REVIEW.md C10).
--
-- cancelled_by → profiles(id) per Q1.
-- ============================================================

ALTER TABLE trips
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid NULL REFERENCES profiles(id);

-- Partial index for the common "show me active trips" query path.
CREATE INDEX IF NOT EXISTS idx_trips_active
  ON trips(id)
  WHERE cancelled_at IS NULL;

INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES ('135', 'phase_c_trips_cancelled', ARRAY[]::text[])
ON CONFLICT (version) DO NOTHING;
```

---

## 3. Migration 136 — `scheduled_reminders`

```sql
-- ============================================================
-- Migration 136: Phase C — scheduled_reminders
--
-- Per-recipient queue for future SMS that fire from the polyglot
-- scheduler (Q22). One row per (trip × recipient × reminder type).
--
-- FK targets per build review:
--   recipient_respondent_id → respondents(id)         (Q18)
--   sent_thread_message_id  → thread_messages(id)     (Q19)
--
-- message_type matches the app-layer set Phase C adds to
-- thread_messages.message_type. No CHECK on thread_messages
-- (matches Q6 convention there); we DO put a CHECK here because
-- a typo would silently drop a reminder.
-- ============================================================

CREATE TABLE IF NOT EXISTS scheduled_reminders (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id                  uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  recipient_respondent_id  uuid NOT NULL REFERENCES respondents(id) ON DELETE CASCADE,
  message_type             text NOT NULL,
  scheduled_for            timestamptz NOT NULL,
  status                   text NOT NULL DEFAULT 'pending',
  sent_thread_message_id   uuid NULL REFERENCES thread_messages(id),
  attempted_at             timestamptz NULL,
  skip_reason              text NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scheduled_reminders_status_check
    CHECK (status IN ('pending','sent','cancelled','skipped')),
  CONSTRAINT scheduled_reminders_message_type_check
    CHECK (message_type IN (
      'rsvp_nudge',
      'profile_completion_nudge',
      'booking_nudge',
      'pre_trip_summary',
      're_engagement'
    ))
);

-- Cron hot path: "any reminder due to fire now?"
CREATE INDEX IF NOT EXISTS idx_scheduled_reminders_due
  ON scheduled_reminders (scheduled_for, status)
  WHERE status = 'pending';

-- Cancellation lookups when the triggering condition resolves.
CREATE INDEX IF NOT EXISTS idx_scheduled_reminders_trip_type
  ON scheduled_reminders (trip_id, message_type);

-- Dedupe: never schedule two pending reminders of the same
-- type to the same recipient on the same trip.
CREATE UNIQUE INDEX IF NOT EXISTS idx_scheduled_reminders_unique_pending
  ON scheduled_reminders (trip_id, recipient_respondent_id, message_type)
  WHERE status = 'pending';

ALTER TABLE scheduled_reminders ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='scheduled_reminders' AND policyname='sched_rem_host_select') THEN
    CREATE POLICY sched_rem_host_select ON scheduled_reminders FOR SELECT
      USING (
        EXISTS (SELECT 1 FROM trips t WHERE t.id = scheduled_reminders.trip_id AND t.created_by = auth.uid())
        OR EXISTS (SELECT 1 FROM trip_cohosts c WHERE c.trip_id = scheduled_reminders.trip_id AND c.user_id = auth.uid())
      );
  END IF;
END$$;

-- No INSERT/UPDATE policy: writes happen only via the service-role
-- worker (scheduler edge function). Host UI can cancel via an API
-- route that uses the service-role client.

INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES ('136', 'phase_c_scheduled_reminders', ARRAY[]::text[])
ON CONFLICT (version) DO NOTHING;
```

---

## 4. Migration 137 — `planner_blasts`

```sql
-- ============================================================
-- Migration 137: Phase C — planner_blasts
--
-- One row per composed blast. composed_by → profiles(id) (Q20).
-- activity_feed_entry_id is set after the blast successfully
-- auto-posts to the feed (build guide §5).
--
-- recipient_segment CHECK matches the four valid segments in the
-- blast composer UI.
-- ============================================================

CREATE TABLE IF NOT EXISTS planner_blasts (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id                  uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  composed_by              uuid NOT NULL REFERENCES profiles(id),
  recipient_segment        text NOT NULL,
  message_body             text NOT NULL,
  include_planner          boolean NOT NULL DEFAULT false,
  recipient_count          integer NOT NULL DEFAULT 0,
  sent_count               integer NOT NULL DEFAULT 0,
  failed_count             integer NOT NULL DEFAULT 0,
  suppressed_opted_out     integer NOT NULL DEFAULT 0,
  scheduled_for            timestamptz NULL,
  sent_at                  timestamptz NULL,
  auto_posted_to_feed      boolean NOT NULL DEFAULT true,
  activity_feed_entry_id   uuid NULL REFERENCES activity_feed_entries(id) ON DELETE SET NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT planner_blasts_segment_check
    CHECK (recipient_segment IN ('going','maybe','invited','all')),
  CONSTRAINT planner_blasts_body_length
    CHECK (char_length(message_body) BETWEEN 1 AND 1600)
);

-- Composer history view + rate-limit math hot path.
CREATE INDEX IF NOT EXISTS idx_planner_blasts_trip_sent
  ON planner_blasts (trip_id, sent_at DESC);

-- Rate-limit math secondary path (7-day window across all of a trip's blasts).
CREATE INDEX IF NOT EXISTS idx_planner_blasts_trip_created
  ON planner_blasts (trip_id, created_at DESC);

ALTER TABLE planner_blasts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='planner_blasts' AND policyname='blasts_host_select') THEN
    CREATE POLICY blasts_host_select ON planner_blasts FOR SELECT
      USING (
        EXISTS (SELECT 1 FROM trips t WHERE t.id = planner_blasts.trip_id AND t.created_by = auth.uid())
        OR EXISTS (SELECT 1 FROM trip_cohosts c WHERE c.trip_id = planner_blasts.trip_id AND c.user_id = auth.uid())
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='planner_blasts' AND policyname='blasts_host_insert') THEN
    CREATE POLICY blasts_host_insert ON planner_blasts FOR INSERT
      WITH CHECK (
        composed_by = auth.uid()
        AND (
          EXISTS (SELECT 1 FROM trips t WHERE t.id = planner_blasts.trip_id AND t.created_by = auth.uid())
          OR EXISTS (SELECT 1 FROM trip_cohosts c WHERE c.trip_id = planner_blasts.trip_id AND c.user_id = auth.uid())
        )
      );
  END IF;
END$$;

INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES ('137', 'phase_c_planner_blasts', ARRAY[]::text[])
ON CONFLICT (version) DO NOTHING;
```

---

## 5. Migration 138 — `planner_blast_sends`

```sql
-- ============================================================
-- Migration 138: Phase C — planner_blast_sends
--
-- One row per recipient per blast. Tracks delivery state and
-- links back to the thread_messages send-log row.
--
--   blast_id                   → planner_blasts(id) (CASCADE)
--   recipient_respondent_id    → respondents(id) (Q18)
--   thread_message_id          → thread_messages(id) (Q19)
--
-- delivery_status mirrors the thread_messages.delivery_status
-- values the existing dm-sender.ts rail writes.
-- ============================================================

CREATE TABLE IF NOT EXISTS planner_blast_sends (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  blast_id                 uuid NOT NULL REFERENCES planner_blasts(id) ON DELETE CASCADE,
  recipient_respondent_id  uuid NOT NULL REFERENCES respondents(id) ON DELETE CASCADE,
  thread_message_id        uuid NULL REFERENCES thread_messages(id),
  delivery_status          text NULL,
  error_code               text NULL,
  sent_at                  timestamptz NULL,
  created_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_planner_blast_sends_blast
  ON planner_blast_sends (blast_id);

CREATE INDEX IF NOT EXISTS idx_planner_blast_sends_recipient
  ON planner_blast_sends (recipient_respondent_id);

-- Dedupe: never send the same blast to the same recipient twice.
CREATE UNIQUE INDEX IF NOT EXISTS idx_planner_blast_sends_unique
  ON planner_blast_sends (blast_id, recipient_respondent_id);

ALTER TABLE planner_blast_sends ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='planner_blast_sends' AND policyname='blast_sends_host_select') THEN
    CREATE POLICY blast_sends_host_select ON planner_blast_sends FOR SELECT
      USING (
        EXISTS (
          SELECT 1
          FROM planner_blasts b
          JOIN trips t ON t.id = b.trip_id
          WHERE b.id = planner_blast_sends.blast_id
            AND (
              t.created_by = auth.uid()
              OR EXISTS (SELECT 1 FROM trip_cohosts c WHERE c.trip_id = t.id AND c.user_id = auth.uid())
            )
        )
      );
  END IF;
END$$;

-- No app-layer INSERT/UPDATE policy: writes go through the
-- service-role send pipeline (sms-trip-blast edge function).

INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES ('138', 'phase_c_planner_blast_sends', ARRAY[]::text[])
ON CONFLICT (version) DO NOTHING;
```

---

## 6. Migration 139 — `trip_reminder_settings`

```sql
-- ============================================================
-- Migration 139: Phase C — trip_reminder_settings
--
-- Per-trip on/off toggles for the 5 auto-reminder types.
-- Hosts can disable any auto reminder via the reminder-settings
-- panel; toggle defaults match the build guide.
--
-- PK = trip_id (one row per trip max). A trip without a row uses
-- the defaults (all enabled).
-- ============================================================

CREATE TABLE IF NOT EXISTS trip_reminder_settings (
  trip_id                      uuid PRIMARY KEY REFERENCES trips(id) ON DELETE CASCADE,
  rsvp_nudge_enabled           boolean NOT NULL DEFAULT true,
  profile_completion_enabled   boolean NOT NULL DEFAULT true,
  booking_nudge_enabled        boolean NOT NULL DEFAULT true,
  pre_trip_summary_enabled     boolean NOT NULL DEFAULT true,
  re_engagement_enabled        boolean NOT NULL DEFAULT true,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  updated_at                   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE trip_reminder_settings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='trip_reminder_settings' AND policyname='trs_host_all') THEN
    CREATE POLICY trs_host_all ON trip_reminder_settings FOR ALL
      USING (
        EXISTS (SELECT 1 FROM trips t WHERE t.id = trip_reminder_settings.trip_id AND t.created_by = auth.uid())
        OR EXISTS (SELECT 1 FROM trip_cohosts c WHERE c.trip_id = trip_reminder_settings.trip_id AND c.user_id = auth.uid())
      )
      WITH CHECK (
        EXISTS (SELECT 1 FROM trips t WHERE t.id = trip_reminder_settings.trip_id AND t.created_by = auth.uid())
        OR EXISTS (SELECT 1 FROM trip_cohosts c WHERE c.trip_id = trip_reminder_settings.trip_id AND c.user_id = auth.uid())
      );
  END IF;
END$$;

INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES ('139', 'phase_c_trip_reminder_settings', ARRAY[]::text[])
ON CONFLICT (version) DO NOTHING;
```

---

## 7. Migration 140 — Planner self-respondent backfill (Q24)

This one's a data migration, not DDL. It inserts a `respondents` row for every existing trip whose planner doesn't already have one, so blast addressing works uniformly. Going-forward inserts happen at trip-creation time in `/api/trips` (Phase C Step 1, app-layer).

```sql
-- ============================================================
-- Migration 140: Phase C — planner self-respondent backfill (Q24)
--
-- For every trip whose planner doesn't yet have a self-respondent
-- row, insert one with rsvp_status='going' and is_planner=true.
-- Idempotent via NOT EXISTS — re-running is safe.
--
-- session_token uses pg-native randomness to match the 48-char
-- hex token shape the Phase A API generates.
-- ============================================================

INSERT INTO respondents (
  trip_id,
  name,
  phone,
  email,
  is_planner,
  rsvp_status,
  rsvp_status_updated_at,
  session_token,
  user_id,
  invited_at
)
SELECT
  t.id,
  COALESCE(NULLIF(p.display_name, ''), 'Planner'),
  p.phone,
  p.email,
  true,
  'going',
  now(),
  encode(gen_random_bytes(24), 'hex'),
  u.id,
  t.created_at
FROM trips t
JOIN profiles p ON p.id = t.created_by
LEFT JOIN users u ON p.phone IS NOT NULL AND u.phone = p.phone
WHERE t.created_by IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM respondents r
    WHERE r.trip_id = t.id
      AND (r.is_planner = true OR (p.phone IS NOT NULL AND r.phone = p.phone))
  );

INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES ('140', 'phase_c_self_respondent_backfill', ARRAY[]::text[])
ON CONFLICT (version) DO NOTHING;
```

**Expected impact at run time:** insert ≤13 rows (one per existing trip whose planner isn't already a respondent). The `OR (r.phone = p.phone)` clause catches the case where the planner manually invited themselves as a guest earlier — we don't want to create a duplicate.

---

## 8. App-layer enum values added to `thread_messages.message_type`

No DDL. The column is unconstrained `text NULL`. Phase C uses these values:

```
rsvp_nudge                  (already in use from Phase A)
profile_completion_nudge    (new — Phase C)
booking_nudge               (new — Phase C)
pre_trip_summary            (new — Phase C)
re_engagement               (new — Phase C)
cancellation_notice         (new — Phase C)
planner_blast               (new — Phase C)
```

Plus four guide-listed values whose UI may or may not land in Phase C (`lodging_vote_open`, `lodging_locked`, `itinerary_vote_open`, `final_headcount`); we'll add these only when an outbound message of that type actually ships.

The typed string-union for the message-type set lives at `/shared/types.ts` (alongside `Trip`, `Respondent`, etc.) and is the single source of truth — the polyglot scheduler and the blast pipeline both import from it.

---

## 9. Idempotency

Every migration uses `IF NOT EXISTS` for tables, columns, indexes, and policies. The `INSERT INTO supabase_migrations.schema_migrations` footer uses `ON CONFLICT DO NOTHING`. Re-running any migration is safe.

The backfill in 140 uses `WHERE NOT EXISTS` — re-running won't insert duplicates.

## 10. Verification queries (run after migrations apply)

```sql
-- 1. Confirm migrations registered
SELECT version, name FROM supabase_migrations.schema_migrations
WHERE version::int BETWEEN 135 AND 140 ORDER BY version::int;
-- Expect: 6 rows.

-- 2. Confirm trips columns
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema='public' AND table_name='trips' AND column_name IN ('cancelled_at','cancelled_by');
-- Expect: 2 rows, both nullable, types timestamptz + uuid.

-- 3. Confirm new tables exist with row counts
SELECT 'scheduled_reminders' AS t, count(*) FROM scheduled_reminders
UNION ALL SELECT 'planner_blasts',         count(*) FROM planner_blasts
UNION ALL SELECT 'planner_blast_sends',    count(*) FROM planner_blast_sends
UNION ALL SELECT 'trip_reminder_settings', count(*) FROM trip_reminder_settings;
-- Expect: all 0.

-- 4. Confirm self-respondent backfill
SELECT t.id, t.name, count(r.id) AS planner_self_respondents
FROM trips t
LEFT JOIN respondents r
  ON r.trip_id = t.id AND r.is_planner = true
GROUP BY t.id, t.name
HAVING count(r.id) = 0;
-- Expect: 0 rows (every trip now has ≥1 planner-self-respondent).
```

## 11. Rollback posture

Per CLAUDE.md hard rule #1: no DROPs in active development. If migration 135 or any new-table migration causes an issue, the rollback is **forward-only** — fix the issue in a new migration (e.g., NULL-ing the bad column, app-layer ignoring the broken table) rather than running a DROP. The post-Phase-C cleanup PR is the only context where DROPs become acceptable, and that targets legacy artifacts not Phase C's.

## 12. What's NOT in this plan (deferred to follow-up)

- **No new triggers.** Phase C's reminder cancellation logic lives at the app layer (scheduler reads triggering-condition before send). If we promote any of it to a SQL trigger later, it lands as a follow-up migration.
- **No changes to `_sms-shared/` schema.** Phase C reuses every existing shared SMS helper.
- **No `iata_to_tz` table.** Q25 ships the IATA→TZ map as a static JSON file in `/shared/`, not a DB table.
- **No drops of legacy artifacts.** Captured in [LEGACY_CLEANUP.md](LEGACY_CLEANUP.md) for the post-Phase-C cleanup PR.

---

## 13. Sign-off checklist

- [ ] All 6 migration SQL blocks above are syntactically correct (verified by reading; would benefit from a dry-run via `supabase db query --linked` against a transaction that rolls back, but that requires a sandbox we don't have set up).
- [ ] Every FK target matches the resolution in BUILD_QUESTIONS (Q1, Q13, Q18, Q19, Q20).
- [ ] Every CHECK constraint enumerates a closed set matching the build guide.
- [ ] All indexes use the `idx_<table>_<columns>` snake_case convention matching Phase A/B.
- [ ] All RLS policies match the existing planner-or-cohost gate pattern.
- [ ] Idempotent on re-run.
- [ ] Verification queries are well-defined.

**Human approval required before running.** When you sign off, I'll execute the migrations one at a time via `supabase db query --linked < supabase/migrations/135_*.sql` (etc.) and run the verification queries between each.

---

## Addendum — 2026-05-18 (alpha: web destination autocomplete)

**Status:** **DDL preview only — nothing has been executed.** Awaiting human sign-off per hard rule #3.
**Why:** Wire Google Places autocomplete into the web destination editor (mobile already has it). Stable `place_id` enables future "fetch place details" / "find nearest airport" lookups without re-geocoding, and unblocks the `suggest-flights` Gemini endpoint that fails (`no_options`) when given vague freeform destinations.
**Reads from:** `SCHEMA_REPORT.md` 2026-05-18 addendum + existing mobile component `src/components/ui/PlacesAutocompleteInput.tsx` + edge function `supabase/functions/places-autocomplete/index.ts`.

### Single migration: `150_alpha_trips_destination_place_id.sql`

```sql
-- 150_alpha_trips_destination_place_id.sql
-- Add Google Places stable identifier to trips.
-- Additive only; existing rows get NULL; no constraints, no indexes.
-- Idempotent via IF NOT EXISTS.

BEGIN;

ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS destination_place_id text NULL;

COMMENT ON COLUMN public.trips.destination_place_id IS
  'Google Places stable place_id for the trip destination. Set by the '
  'web + mobile autocomplete on selection. NULL = freeform destination '
  'never reconciled to a Google Place (legacy rows + manual edits).';

COMMIT;
```

### Compliance against hard rule #1 (additive only)

| Operation | Used? | Status |
|---|---|---|
| `ADD COLUMN` (nullable, no default) | ✅ | allowed |
| `DROP COLUMN` | — | not used |
| `RENAME COLUMN` | — | not used |
| `ALTER COLUMN ... TYPE` | — | not used |
| `ALTER COLUMN ... NOT NULL` | — | not used |
| `DROP CONSTRAINT` | — | not used |
| Adding CHECK | — | not used (place_id formats vary across Google's API history; freeform text is safer) |
| Adding INDEX | — | not used (no query pattern justifies it yet — YAGNI) |
| `CREATE TABLE` | — | not used |
| RLS policy change | — | not used (existing trips RLS policies cover the new column automatically) |

✅ Fully additive. Safe to re-run (`IF NOT EXISTS` guards against duplicate-column errors).

### Verification queries to run after migration

```sql
-- 1. Confirm the column landed
SELECT column_name, data_type, is_nullable
FROM   information_schema.columns
WHERE  table_schema = 'public' AND table_name = 'trips'
  AND  column_name  = 'destination_place_id';
-- expected: 1 row, text, YES

-- 2. Confirm existing rows are NULL on the new column (no surprise backfill)
SELECT count(*) FILTER (WHERE destination_place_id IS NULL) AS null_count,
       count(*) FILTER (WHERE destination_place_id IS NOT NULL) AS not_null_count
FROM   public.trips;
-- expected: null_count = total trip count, not_null_count = 0

-- 3. Confirm no new CHECK appeared
SELECT con.conname
FROM   pg_constraint con
JOIN   pg_class      cls ON cls.oid = con.conrelid
WHERE  cls.relname = 'trips' AND con.contype = 'c'
  AND  pg_get_constraintdef(con.oid) ILIKE '%destination_place_id%';
-- expected: zero rows
```

### Downstream code changes (post-migration, no DB impact)

| File | Change |
|---|---|
| `shared/types.ts` | Add `destination_place_id?: string \| null` to `Trip` interface |
| `web/app/api/trips/route.ts` (POST) | Accept `destination_place_id` + `destination_address` on insert |
| `web/app/api/trips/[id]/route.ts` (PATCH) | Accept `destination_place_id` + `destination_address` on update |
| `web/lib/api/places.ts` (NEW) | Web wrapper calling the existing `places-autocomplete` edge function |
| `web/lib/ui/places-autocomplete-input.tsx` (NEW) | React (DOM) port of the mobile component |
| `web/app/trips/[id]/editable-hero.tsx` | Replace destination `EditableText` with `EditablePlace` (custom) for canEdit mode; falls back to plain text display when not editing |
| `web/app/api/trips/[id]/travel/suggest-flights/route.ts` | When `destination_address` is set, pass it to the Gemini prompt instead of the short `destination` — fixes the `no_options` ambiguity |

### Sign-off checklist

- [x] Schema inspection complete (SCHEMA_REPORT.md addendum).
- [x] Pure additive (rule #1).
- [x] No NULL→NOT NULL transitions, no DROPs, no RENAMEs.
- [x] Idempotent (`IF NOT EXISTS`).
- [x] Verification queries defined.
- [x] RLS automatically covers the new column (no policy change needed).
- [ ] **Human approval — awaiting sign-off.**

**On approval**: paste the migration block into the Supabase SQL editor → run → paste back the three verification query results → I commit the migration file at `supabase/migrations/150_alpha_trips_destination_place_id.sql` so the migration history matches prod → build the web components.
