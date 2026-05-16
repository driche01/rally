-- ============================================================
-- Migration 114: Drop dead paywall / IAP artifacts
--
-- Migration 004 ("Phase 2 — Logistics Engine") added an IAP / discount-
-- code paywall scaffolding that gated the per-day RSVP feature behind
-- `trips.phase2_unlocked`. The paywall UI was never built — no code
-- path ever wrote `phase2_unlocked = true`, the day-RSVP UI on the
-- public respond page was permanently unreachable, and the discount-
-- code tables sat empty (one stray seed row in `discount_codes`,
-- zero redemptions in `discount_code_redemptions`).
--
-- The 2026-05-03 stage-machine simplification confirmed `phase2_unlocked`
-- is no longer read by `getTripStage` (the `planning` stage was retired
-- because it gated on this flag and was never reachable). The TS layer
-- has been cleaned up in the same session — `subscriptions.ts`,
-- `useSubscription.ts`, the `Phase2UnlockMethod` / `DiscountCode` /
-- `DiscountCodeRedemption` types, and the day-RSVP UI are gone.
--
-- This migration drops the now-unreachable DB artifacts:
--   - `trips.phase2_unlocked`, `trips.phase2_unlocked_at`,
--     `trips.phase2_unlock_method` columns
--   - `discount_code_redemptions` table (FK to discount_codes — drop first)
--   - `discount_codes` table
--   - `increment_discount_code_use_count(uuid)` helper RPC
--
-- All `IF EXISTS` so this is safe to re-run. The drops are logically
-- destructive but reversible by re-running migration 004 on a clean
-- DB; the gate this all defended (per-day RSVP) was never live, so no
-- planner UX changes from this migration.
-- ============================================================

-- Drop the discount-code helper RPC. No app code calls it.
DROP FUNCTION IF EXISTS increment_discount_code_use_count(uuid);

-- Drop the FK-dependent table first.
DROP TABLE IF EXISTS discount_code_redemptions;
DROP TABLE IF EXISTS discount_codes;

-- Drop the unlock columns from trips. The CHECK constraint on
-- phase2_unlock_method gets removed implicitly with the column.
ALTER TABLE trips
  DROP COLUMN IF EXISTS phase2_unlock_method,
  DROP COLUMN IF EXISTS phase2_unlocked_at,
  DROP COLUMN IF EXISTS phase2_unlocked;
