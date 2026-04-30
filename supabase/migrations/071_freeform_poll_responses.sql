-- ============================================================
-- Migration 071: free-form numeric poll responses
--
-- Adds support for poll_responses that carry an integer value instead
-- of pointing at a specific poll_options row. This lets the duration
-- poll accept open-ended numeric answers ("how many nights?") when
-- the planner doesn't pre-set duration chips.
--
-- Schema changes:
--   • poll_responses.option_id becomes nullable
--   • poll_responses.numeric_value INTEGER added
--   • CHECK ensures exactly one of (option_id, numeric_value) is set
--
-- Existing rows (option-based) are unaffected.
-- ============================================================

ALTER TABLE public.poll_responses
  ALTER COLUMN option_id DROP NOT NULL;

ALTER TABLE public.poll_responses
  ADD COLUMN IF NOT EXISTS numeric_value INTEGER;

-- Drop any existing constraint with this name (idempotent re-runs)
ALTER TABLE public.poll_responses
  DROP CONSTRAINT IF EXISTS poll_responses_option_or_numeric_chk;

ALTER TABLE public.poll_responses
  ADD CONSTRAINT poll_responses_option_or_numeric_chk
  CHECK (
    (option_id IS NOT NULL AND numeric_value IS NULL)
    OR
    (option_id IS NULL AND numeric_value IS NOT NULL)
  );
