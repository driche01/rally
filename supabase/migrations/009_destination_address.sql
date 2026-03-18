-- Store the full address / place description separately from the display name.
-- destination        = short display name shown in the UI, e.g. "Dawn Ranch"
-- destination_address = full address used for map deep-links, e.g. "Dawn Ranch, California 116, Guerneville, CA, USA"
ALTER TABLE trips ADD COLUMN IF NOT EXISTS destination_address text;
