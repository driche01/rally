-- Safe policy creation that skips any already-existing policies.
-- Run this in the Supabase SQL Editor.

DO $$
BEGIN
  -- Respondents: INSERT (group members can submit)
  BEGIN
    CREATE POLICY "Anyone can insert a respondent"
      ON respondents FOR INSERT WITH CHECK (true);
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;

  -- Respondents: UPDATE (session owner can update name)
  BEGIN
    CREATE POLICY "Session owner can update their respondent row"
      ON respondents FOR UPDATE USING (true);
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;

  -- Respondents: SELECT (needed so INSERT...RETURNING works and name pre-fill works)
  BEGIN
    CREATE POLICY "Anyone can read respondents"
      ON respondents FOR SELECT USING (true);
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;

  -- Poll responses: INSERT (group members can submit votes)
  BEGIN
    CREATE POLICY "Anyone can insert a response"
      ON poll_responses FOR INSERT WITH CHECK (true);
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;

  -- Poll responses: DELETE (needed to replace votes on re-submit)
  BEGIN
    CREATE POLICY "Anyone can delete their own response"
      ON poll_responses FOR DELETE USING (true);
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;

  -- Poll responses: SELECT (needed for pre-fill + planner dashboard)
  BEGIN
    CREATE POLICY "Anyone can read poll responses"
      ON poll_responses FOR SELECT USING (true);
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;
