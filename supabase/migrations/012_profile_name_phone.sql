-- Add last_name and phone to profiles table
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS last_name text,
  ADD COLUMN IF NOT EXISTS phone text;
