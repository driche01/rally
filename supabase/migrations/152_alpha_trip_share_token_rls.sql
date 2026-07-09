-- 152_alpha_trip_share_token_rls.sql
--
-- Close the anonymous "read every trip" hole (code review Batch A, 1.2).
--
-- Migration 013 added:
--   CREATE POLICY "Unauthenticated users can read trips via share link"
--     ON trips FOR SELECT USING (auth.role() = 'anon');
-- This grants EVERY anonymous caller SELECT on EVERY trip row — the
-- share_token match lives only in application code (.eq("share_token",…)),
-- which an attacker simply omits. Because the browser uses the RLS-bound
-- publishable/anon key, anyone can dump all trips + their private share
-- links. See CODE_REVIEW_BATCH_A_SIGNOFF.md §1.2.
--
-- The two anonymous (logged-out) trip reads are both server components
-- (web/app/invite/[token]/page.tsx and .../rsvp/page.tsx); they are
-- switched to the service-role client in the SAME change, so anon no
-- longer needs table-level SELECT on trips. The authenticated policy
-- ("Authenticated users can read their own trips", creator OR member,
-- migration 016) is retained unchanged, and the only realtime channel in
-- the app is on the activity feed, not trips.
--
-- Not a column/table change — this only removes an over-permissive
-- policy, so CLAUDE.md rule #1 (additive-only for schema) is satisfied.
--
-- ⚠️ DEPLOY ORDERING (hard requirement):
-- This must be applied to prod ONLY AFTER the paired web change (the
-- invite pages switched to service-role) is LIVE in prod (i.e. after the
-- `release` promotion). There is a single shared Supabase project, so
-- dropping this policy before the new web code is live would 404 the
-- public invite page for logged-out visitors. Apply command after ship:
--   supabase db query --linked \
--     "DROP POLICY IF EXISTS \"Unauthenticated users can read trips via share link\" ON trips;"
-- (This file mirrors that statement for version history; prod apply is
-- done directly, matching the project convention used by migration 150.)

BEGIN;

DROP POLICY IF EXISTS "Unauthenticated users can read trips via share link" ON trips;

COMMIT;
