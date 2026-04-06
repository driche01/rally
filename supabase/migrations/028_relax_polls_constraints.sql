-- Expand polls type + status constraints for SMS agent poll types

-- Add SMS-specific poll types
ALTER TABLE polls DROP CONSTRAINT polls_type_check;
ALTER TABLE polls ADD CONSTRAINT polls_type_check
  CHECK (type IN (
    'destination', 'dates', 'budget', 'custom',
    'destination_vote', 'commit', 'lodging_type', 'propose'
  ));

-- Add 'open' as alias for 'live' (SMS agent uses 'open')
ALTER TABLE polls DROP CONSTRAINT polls_status_check;
ALTER TABLE polls ADD CONSTRAINT polls_status_check
  CHECK (status IN ('draft', 'live', 'open', 'closed', 'decided', 'abandoned'));
