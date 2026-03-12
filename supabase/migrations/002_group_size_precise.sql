-- Add an optional exact group size column.
-- When set it supersedes group_size_bucket for participation calculations.
alter table trips
  add column group_size_precise integer
    check (group_size_precise is null or (group_size_precise >= 1 and group_size_precise <= 999));
