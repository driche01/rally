-- Drop the pending_planners table.
--
-- This table was originally used for 1:1 pre-registration: when someone
-- texted Rally directly, their phone was stashed here with a 24h TTL so
-- that when Rally was later added to a group, the matching phone could
-- be auto-promoted to planner. The 1:1 pre-registration flow was removed
-- (handle1to1 now returns null; planners just add Rally to an existing
-- group thread), making this table dead code.

drop index if exists idx_pending_planners_expires;
drop table if exists pending_planners;
