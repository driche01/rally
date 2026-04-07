-- Dedicated per-participant phase confirmation flag.
-- Previously, trip_session_participants.budget_raw was reused as a sub-state
-- flag holding 'DATE_CONFIRMED' or 'PREFILL_CONFIRMED', which collided with
-- actual budget text. Split those flags into their own column.

alter table trip_session_participants
  add column if not exists phase_confirmation text;

-- Backfill: migrate existing DATE_CONFIRMED / PREFILL_CONFIRMED flag values
-- off of budget_raw onto the new column, then clear them from budget_raw.
update trip_session_participants
  set phase_confirmation = budget_raw,
      budget_raw = null
  where budget_raw in ('DATE_CONFIRMED', 'PREFILL_CONFIRMED');
