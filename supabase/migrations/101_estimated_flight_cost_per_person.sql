-- ============================================================
-- Migration 101: estimated_flight_cost_per_person on trips
--
-- Numeric estimate (USD) the future flights card will populate.
-- The lodging-suggestion edge function reads this to compute the
-- remaining per-person budget for lodging so suggestions don't
-- push the group over their stated budget once travel is added in.
--
-- Null means "no estimate yet" — the lodging prompt falls back to
-- the full per-person budget without subtracting flight costs.
-- ============================================================

ALTER TABLE trips
  ADD COLUMN IF NOT EXISTS estimated_flight_cost_per_person numeric;

COMMENT ON COLUMN trips.estimated_flight_cost_per_person IS
  'USD per-person estimate for flights, populated by the flights card. Used by suggest-lodging to size remaining lodging budget.';
