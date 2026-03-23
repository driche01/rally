-- Allow planners to directly insert, update, and delete respondents for their trips.

CREATE POLICY "trip owner can insert respondents"
  ON respondents FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM trips
      WHERE trips.id = respondents.trip_id
        AND trips.created_by = auth.uid()
    )
  );

CREATE POLICY "trip owner can update respondents"
  ON respondents FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM trips
      WHERE trips.id = respondents.trip_id
        AND trips.created_by = auth.uid()
    )
  );

CREATE POLICY "trip owner can delete respondents"
  ON respondents FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM trips
      WHERE trips.id = respondents.trip_id
        AND trips.created_by = auth.uid()
    )
  );
