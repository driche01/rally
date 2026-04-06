-- Allow SMS-created trips to have no profile owner (created_by nullable)
ALTER TABLE trips ALTER COLUMN created_by DROP NOT NULL;
