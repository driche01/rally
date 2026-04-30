-- ============================================================
-- Migration 078: app_add_trip_contacts RPC
--
-- Lets the trip planner bulk-add the contacts they picked at trip
-- creation into trip_session_participants. The legacy path (a direct
-- client-side insert from src/lib/api/trips.ts → addContactsAsParticipants)
-- silently failed because trip_session_participants has RLS enabled
-- (migration 032) but only a SELECT policy for authenticated users
-- (migration 040). Inserts from the planner's anon-keyed client were
-- denied; only the planner themself ended up in the table (via the
-- existing app_create_sms_session SECURITY DEFINER RPC).
--
-- This RPC closes that gap. SECURITY DEFINER bypasses the RLS write
-- gate, but the function itself enforces the same authorization rule
-- as remove_session_participant: the caller must be the trip's
-- created_by OR the SMS-side planner of the live session.
--
-- Idempotent — safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION app_add_trip_contacts(
  p_trip_id  uuid,
  p_contacts jsonb  -- array of { name: text, phone: text, email: text? }
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid              uuid;
  v_session_id       uuid;
  v_session_planner  uuid;
  v_caller_users_id  uuid;
  v_authorized       boolean := false;
  v_contact          jsonb;
  v_normalized_phone text;
  v_user_id          uuid;
  v_added            int := 0;
  v_skipped          int := 0;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  -- ─── Authorize: caller must be planner of this trip ──────────────────
  SELECT id INTO v_caller_users_id FROM users WHERE auth_user_id = v_uid LIMIT 1;

  SELECT id, planner_user_id
  INTO   v_session_id, v_session_planner
  FROM   trip_sessions
  WHERE  trip_id = p_trip_id
    AND  status IN ('ACTIVE', 'PAUSED', 'RE_ENGAGEMENT_PENDING', 'FIRST_BOOKING_REACHED')
  ORDER BY created_at DESC
  LIMIT  1;

  IF v_session_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'session_missing');
  END IF;

  IF v_caller_users_id IS NOT NULL AND v_caller_users_id = v_session_planner THEN
    v_authorized := true;
  ELSE
    SELECT EXISTS (
      SELECT 1 FROM trips t
      WHERE  t.id = p_trip_id AND t.created_by = v_uid
    ) INTO v_authorized;
  END IF;

  IF NOT v_authorized THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  -- ─── Iterate the contacts payload ────────────────────────────────────
  -- Each entry: { name, phone, email? }. Bad entries are skipped, not
  -- fatal — one bad phone shouldn't block the rest.
  FOR v_contact IN SELECT * FROM jsonb_array_elements(coalesce(p_contacts, '[]'::jsonb))
  LOOP
    v_normalized_phone := normalize_phone(v_contact->>'phone');
    IF v_normalized_phone IS NULL THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    -- find-or-create users row for this phone
    SELECT id INTO v_user_id FROM users WHERE phone = v_normalized_phone LIMIT 1;
    IF v_user_id IS NULL THEN
      INSERT INTO users (phone, display_name, rally_account, opted_out)
      VALUES (
        v_normalized_phone,
        nullif(v_contact->>'name', ''),
        false,
        false
      )
      RETURNING id INTO v_user_id;
    ELSE
      -- Refresh display_name only if currently null/empty — don't clobber
      -- a name another planner / claim flow already set.
      UPDATE users
      SET    display_name = coalesce(nullif(display_name, ''), nullif(v_contact->>'name', ''))
      WHERE  id = v_user_id;
    END IF;

    -- Upsert participant row. Conflict on (trip_session_id, phone) means
    -- re-adding the same person updates display_name + flips them back
    -- to active if they were soft-removed.
    INSERT INTO trip_session_participants (
      trip_session_id, user_id, phone, display_name,
      status, is_attending, is_planner
    )
    VALUES (
      v_session_id, v_user_id, v_normalized_phone,
      nullif(v_contact->>'name', ''),
      'active', true, false
    )
    ON CONFLICT (trip_session_id, phone) DO UPDATE
      SET status        = CASE
                            WHEN trip_session_participants.is_planner THEN trip_session_participants.status
                            ELSE 'active'
                          END,
          is_attending  = true,
          display_name  = coalesce(
                            nullif(trip_session_participants.display_name, ''),
                            EXCLUDED.display_name
                          ),
          updated_at    = now();

    v_added := v_added + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'session_id', v_session_id,
    'added', v_added,
    'skipped', v_skipped
  );
END;
$$;

GRANT EXECUTE ON FUNCTION app_add_trip_contacts(uuid, jsonb) TO authenticated;
