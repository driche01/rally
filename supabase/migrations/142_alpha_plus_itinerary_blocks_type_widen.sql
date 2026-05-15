-- ============================================================
-- Migration 142: Alpha+ — widen itinerary_blocks.type CHECK
--
-- Bug: AI itinerary generation insert was failing with
--      "new row for relation 'itinerary_blocks' violates check
--       constraint 'itinerary_blocks_type_check'"
--
-- Root cause: Phase B Q11 RESOLVED to extend the CHECK to cover
-- both Expo + Phase B values, but the live constraint was never
-- widened — only the Expo set was allowed. The app-layer
-- normalizer (web/app/api/trips/[id]/itinerary/generate/route.ts)
-- emits Phase B values ('lodging','transit','other') that the DB
-- then rejects.
--
-- Fix: drop + re-add the CHECK with a superset of the current
-- values. Existing rows (3 accommodation, 22 activity, 7 free_time,
-- 36 meal, 5 travel) all remain valid under the new constraint.
-- This is structurally additive: the new set contains every value
-- previously allowed plus the Phase B additions.
-- ============================================================

ALTER TABLE itinerary_blocks
  DROP CONSTRAINT IF EXISTS itinerary_blocks_type_check;

ALTER TABLE itinerary_blocks
  ADD CONSTRAINT itinerary_blocks_type_check
  CHECK (type IN (
    -- Expo-era values (preserved)
    'activity',
    'meal',
    'travel',
    'accommodation',
    'free_time',
    -- Phase B additions (per Q11)
    'lodging',
    'transit',
    'other'
  ));

INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES ('142', 'alpha_plus_itinerary_blocks_type_widen', ARRAY[]::text[])
ON CONFLICT (version) DO NOTHING;
