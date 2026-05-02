-- Migration 111: Trip drafts
--
-- Adds 'draft' as a valid trips.status. A draft is a fully-isolated
-- Rally — no SMS session, no participants, no polls, no nudges. The
-- planner saves their in-progress form state into trips.form_draft
-- (JSONB) and resumes editing from the New Rally screen. On promotion
-- to status='active' the snapshot is consumed (contacts → participants,
-- multi-select fields → live polls, scheduler poked) and form_draft is
-- cleared.
--
-- Why a JSONB blob and not separate columns: most fields the planner
-- captures at creation (multiple destinations, picked dates, multi-budget,
-- contact picker, custom polls) don't have a single-value home on the
-- trips table. They become poll options *after* promotion. Storing a
-- typed snapshot keeps the schema small and lets the form's serialization
-- evolve without follow-up migrations.
--
-- RLS is unchanged — the existing "Planners can manage their own trips"
-- policy already covers drafts (gate is created_by, not status). The
-- public share_token read path is also unaffected: getTripByShareToken
-- already filters status='active', so drafts never leak via share links.

ALTER TABLE trips DROP CONSTRAINT IF EXISTS trips_status_check;

ALTER TABLE trips
  ADD CONSTRAINT trips_status_check
  CHECK (status IN ('active', 'closed', 'draft'));

ALTER TABLE trips
  ADD COLUMN IF NOT EXISTS form_draft jsonb;
