-- Mirror profiles.phone to users.phone for the linked auth user.
--
-- Backstop against profile/users phone drift. The incident on
-- 2026-04-30 had profiles.phone=+13392448125 (a typo) while
-- users.phone=+13098430233 (an unrelated stale value) for the same
-- auth user, and the SMS subsystem reads users.phone — so initial
-- outreach went to a number nobody owned.
--
-- After this trigger, any write to profiles.phone propagates to the
-- linked users row. If it would collide with users.phone uniqueness
-- (another row already owns that phone), the trigger throws — that's
-- the desired behavior, since the collision is itself a sign of drift
-- the operator needs to resolve.
--
-- Direction is profiles → users only. The reverse (users → profiles)
-- is intentionally not synced: SMS-side flows (a stranger texting in,
-- claim handshakes) write users.phone all the time without that being
-- a profile change, and overwriting profiles.phone from those paths
-- would surprise the planner.

CREATE OR REPLACE FUNCTION sync_profile_phone_to_users()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.phone IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.phone IS NOT DISTINCT FROM OLD.phone THEN
    RETURN NEW;
  END IF;

  UPDATE users
  SET    phone = NEW.phone
  WHERE  auth_user_id = NEW.id
    AND  phone IS DISTINCT FROM NEW.phone;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_profile_phone_to_users ON profiles;
CREATE TRIGGER trg_sync_profile_phone_to_users
AFTER INSERT OR UPDATE OF phone ON profiles
FOR EACH ROW
EXECUTE FUNCTION sync_profile_phone_to_users();
