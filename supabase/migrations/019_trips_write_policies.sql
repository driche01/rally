-- 019_trips_write_policies.sql
-- The trips table had SELECT policies but no INSERT/UPDATE/DELETE policies,
-- so planners could read trips but couldn't create, edit, or delete them.

CREATE POLICY "Planners can create trips"
  ON trips FOR INSERT
  WITH CHECK (created_by = auth.uid());

CREATE POLICY "Planners can update their trips"
  ON trips FOR UPDATE
  USING (created_by = auth.uid());

CREATE POLICY "Planners can delete their trips"
  ON trips FOR DELETE
  USING (created_by = auth.uid());
