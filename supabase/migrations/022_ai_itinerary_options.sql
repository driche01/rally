-- Phase 4.2 — AI itinerary generation
--
-- ai_itinerary_options: one row per trip, stores the 3 AI-generated itinerary
-- options. The edge function upserts this row (status='generating' first, then
-- 'ready' or 'error' once the Claude response arrives). The planner picks an
-- option and it gets written to itinerary_blocks; applied_at marks that moment.

CREATE TABLE ai_itinerary_options (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id           uuid        NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  status            text        NOT NULL DEFAULT 'generating'
                                CHECK (status IN ('generating', 'ready', 'error')),
  -- JSONB array of AiItineraryOption objects (see types/database.ts)
  options           jsonb       NOT NULL DEFAULT '[]'::jsonb,
  -- Optional freetext override the planner supplied when triggering generation
  planner_override  text,
  -- Which option index the planner selected (0-based)
  selected_index    int,
  -- Timestamp when the selected option was applied to itinerary_blocks
  applied_at        timestamptz,
  error_message     text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  -- One draft per trip (upserted on conflict)
  UNIQUE (trip_id)
);

ALTER TABLE ai_itinerary_options ENABLE ROW LEVEL SECURITY;

-- Authenticated trip members can read their trip's AI options
CREATE POLICY "trip members can view ai_itinerary_options"
  ON ai_itinerary_options FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM trip_members tm
      WHERE tm.trip_id = ai_itinerary_options.trip_id
        AND tm.user_id = auth.uid()
    )
  );

-- Only planners can update (mark applied, etc.) directly from the client
CREATE POLICY "planners can update ai_itinerary_options"
  ON ai_itinerary_options FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM trip_members tm
      WHERE tm.trip_id = ai_itinerary_options.trip_id
        AND tm.user_id = auth.uid()
        AND tm.role = 'planner'
    )
  );

-- Inserts and full upserts are done via the service-role edge function (bypasses RLS)
