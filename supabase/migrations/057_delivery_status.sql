-- ============================================================
-- Migration 057: Twilio delivery status tracking
--
-- Every outbound SMS gets a Twilio MessageSid. Twilio delivers async
-- status callbacks (queued → sent → delivered, or → failed / undelivered)
-- to a webhook we expose. Without storing this we can't tell the planner
-- when a participant's nudge bounced — they look "active" in the
-- dashboard but never got the message.
--
-- This migration adds delivery columns to thread_messages (the system of
-- record for every outbound SMS, including nudges, broadcasts, and
-- redirect replies). nudge_sends still carries its own message_sid, but
-- the join key for delivery state is thread_messages.
--
-- The webhook (supabase/functions/sms-status-webhook) writes here.
-- ============================================================

ALTER TABLE thread_messages
  ADD COLUMN IF NOT EXISTS delivery_status     text,
    -- Twilio statuses: queued | sending | sent | delivered | undelivered | failed
  ADD COLUMN IF NOT EXISTS delivery_status_at  timestamptz,
  ADD COLUMN IF NOT EXISTS error_code          text;
    -- Twilio error code on failure (e.g. '30005' = unknown destination)

-- Hot path: dashboard "couldn't deliver" badge — find participants whose
-- most recent outbound message failed.
CREATE INDEX IF NOT EXISTS idx_thread_messages_failed_per_session
  ON thread_messages(trip_session_id, sender_phone, created_at DESC)
  WHERE delivery_status IN ('failed', 'undelivered');
