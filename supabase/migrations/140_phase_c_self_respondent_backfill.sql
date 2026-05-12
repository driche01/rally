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
  COALESCE(
    NULLIF(trim(coalesce(p.name, '') || ' ' || coalesce(p.last_name, '')), ''),
    NULLIF(u.display_name, ''),
    'Planner'
  ),
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

-- For trips where the planner was already invited as a respondent
-- by phone but with is_planner=false, promote that flag so the
-- blast pipeline can identify them uniformly. Doesn't touch
-- rsvp_status — preserves whatever they've already RSVPed.
UPDATE respondents r
SET is_planner = true
FROM trips t
JOIN profiles p ON p.id = t.created_by
WHERE r.trip_id = t.id
  AND r.is_planner = false
  AND p.phone IS NOT NULL
  AND r.phone = p.phone;

INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES ('140', 'phase_c_self_respondent_backfill', ARRAY[]::text[])
ON CONFLICT (version) DO NOTHING;
