-- Add '0-4' to group_size_bucket check constraint
alter table trips
  drop constraint trips_group_size_bucket_check;

alter table trips
  add constraint trips_group_size_bucket_check
  check (group_size_bucket in ('0-4', '5-8', '9-12', '13-20', '20+'));

-- Add 'custom' to polls type check constraint
alter table polls
  drop constraint polls_type_check;

alter table polls
  add constraint polls_type_check
  check (type in ('destination', 'dates', 'budget', 'custom'));
