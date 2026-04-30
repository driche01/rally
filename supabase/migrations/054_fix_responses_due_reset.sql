-- ============================================================
-- Migration 054: Fix responses_due_date reset semantics
--
-- Caught by scripts/run-cadence-verification.js: when a planner had
-- previously overridden responses_due_date and then writes
--   UPDATE trips SET book_by_date = X, responses_due_date = NULL
-- intending to "reset to default", the trigger from migration 044 saw
-- the NULL as an explicit override and left responses_due_date NULL.
-- That cascaded into the scheduler skipping the trip entirely (no
-- nudges seeded, no synthesis, no recommendations).
--
-- Fix: explicit NULL on responses_due_date with a non-null book_by_date
-- means "use the default." The trigger now recomputes in that case.
-- ============================================================

CREATE OR REPLACE FUNCTION trips_default_responses_due_date()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Clearing book_by clears the deadline too unless the caller wrote
  -- an explicit value in the same statement.
  IF NEW.book_by_date IS NULL THEN
    IF (TG_OP = 'INSERT') OR (NEW.responses_due_date IS NOT DISTINCT FROM OLD.responses_due_date) THEN
      NEW.responses_due_date := NULL;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.responses_due_date IS NULL THEN
      NEW.responses_due_date := NEW.book_by_date - 3;
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE path:
  --   1. If the caller explicitly set responses_due_date to NULL while
  --      book_by_date is set, treat it as a reset request and recompute.
  --   2. If book_by_date changed and responses_due_date wasn't explicitly
  --      written in the same statement, recompute.
  --   3. Otherwise respect the planner's explicit responses_due_date value
  --      (the extend-deadline override path).
  IF NEW.responses_due_date IS NULL AND NEW.book_by_date IS NOT NULL THEN
    NEW.responses_due_date := NEW.book_by_date - 3;
  ELSIF NEW.book_by_date IS DISTINCT FROM OLD.book_by_date
        AND NEW.responses_due_date IS NOT DISTINCT FROM OLD.responses_due_date THEN
    NEW.responses_due_date := NEW.book_by_date - 3;
  END IF;

  RETURN NEW;
END;
$$;
