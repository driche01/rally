-- Prevent duplicate canonical polls per trip.
--
-- Polls of type 'destination' / 'dates' / 'budget' are 1-per-trip by design
-- (the trip primitive backs them). 'custom' polls can repeat freely and the
-- 'sms_*' types from migration 028 are conversational artifacts that may
-- appear multiple times — neither is constrained here.
--
-- This index is the DB-level backstop for the duplicate-poll bug
-- investigated 2026-04-29: a race between syncTripFieldsToPolls (run from
-- useUpdateTrip.onSuccess) and the edit screen's rebuildPoll could insert
-- a second 'dates' or 'budget' poll alongside the rebuilt one. The client
-- code was fixed at the same time; this index stops any future
-- regression at the row level.
--
-- Apply order: if `polls` already contains duplicates of these types,
-- this CREATE will fail. Run `scripts/cleanup-duplicate-polls.sql`
-- first, then re-run the migration.

CREATE UNIQUE INDEX IF NOT EXISTS polls_one_canonical_per_trip
  ON polls (trip_id, type)
  WHERE type IN ('destination', 'dates', 'budget');
