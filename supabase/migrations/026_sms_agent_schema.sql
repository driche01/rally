-- ============================================================
-- Migration 026: SMS Agent Schema
-- Reconciliation: ALTER 3 existing tables, CREATE 13 new tables
-- See: rally-sms-bot-build-guide.md Step 0
-- ============================================================

-- ─── 1. ALTER EXISTING TABLES ────────────────────────────────

-- 1a. polls — add SMS agent columns
-- (trip_session_id FK added after trip_sessions table is created below)
ALTER TABLE polls ADD COLUMN IF NOT EXISTS phase text;
ALTER TABLE polls ADD COLUMN IF NOT EXISTS opened_at timestamptz;
ALTER TABLE polls ADD COLUMN IF NOT EXISTS closed_at timestamptz;
ALTER TABLE polls ADD COLUMN IF NOT EXISTS winner text;
ALTER TABLE polls ADD COLUMN IF NOT EXISTS nudge_24h_sent_at timestamptz;
ALTER TABLE polls ADD COLUMN IF NOT EXISTS nudge_48h_sent_at timestamptz;

-- 1b. poll_responses — add channel tracking
ALTER TABLE poll_responses ADD COLUMN IF NOT EXISTS channel text;
-- values: 'sms' | 'web' | 'app' (nullable for legacy rows)

-- 1c. respondents — add user_id FK (created after users table below)
-- Index for phone lookup within a trip
CREATE INDEX IF NOT EXISTS idx_respondents_trip_phone
  ON respondents(trip_id, phone);


-- ─── 2. CREATE NEW TABLES ────────────────────────────────────

-- 2a. users — phone-first cross-trip identity (SMS agent Component 2)
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL UNIQUE,
  display_name text,
  email text UNIQUE,
  rally_account boolean DEFAULT false,
  trip_count integer DEFAULT 0,
  opted_out boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);

-- Now add respondents.user_id FK
ALTER TABLE respondents ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id);
CREATE INDEX IF NOT EXISTS idx_respondents_user_id ON respondents(user_id);

-- 2b. pending_planners — 1:1 pre-registration with 24h TTL
CREATE TABLE IF NOT EXISTS pending_planners (
  phone text PRIMARY KEY,
  registered_at timestamptz DEFAULT now(),
  expires_at timestamptz DEFAULT now() + interval '24 hours'
);
CREATE INDEX IF NOT EXISTS idx_pending_planners_expires
  ON pending_planners(expires_at);

-- 2c. trip_sessions — SMS state machine
CREATE TABLE IF NOT EXISTS trip_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid REFERENCES trips(id),
  thread_id text NOT NULL UNIQUE,
  planner_user_id uuid REFERENCES users(id),
  phase text NOT NULL DEFAULT 'INTRO',
  destination_candidates jsonb DEFAULT '[]',
  destination text,
  dates jsonb,
  deadlines jsonb DEFAULT '[]',
  last_flight_price numeric,
  last_flight_trend text,
  flight_price_last_checked_at timestamptz,
  budget_responses jsonb DEFAULT '[]',
  budget_median numeric,
  budget_range jsonb,
  budget_status text DEFAULT 'PENDING',
  participant_origins jsonb DEFAULT '[]',
  subgroup_flights jsonb DEFAULT '[]',
  cost_estimates jsonb DEFAULT '[]',
  lodging_recommendations jsonb DEFAULT '[]',
  wishlist_url text,
  wishlist_shared_by_user_id uuid REFERENCES users(id),
  lodging_type text,
  lodging_cost numeric,
  lodging_property text,
  status text NOT NULL DEFAULT 'ACTIVE',
  phase_sub_state text,
  celebration_started_at timestamptz,
  last_message_at timestamptz DEFAULT now(),
  committed_participants jsonb DEFAULT '[]',
  parent_session_id uuid REFERENCES trip_sessions(id),
  child_session_id uuid REFERENCES trip_sessions(id),
  thread_name text,
  planner_flight_link text,
  pre_trip_payment_reminder_sent boolean DEFAULT false,
  paused boolean DEFAULT false,
  paused_at timestamptz,
  re_engagement_sent boolean DEFAULT false,
  re_engagement_sent_at timestamptz,
  momentum_check_sent_at timestamptz,
  version integer DEFAULT 0,
  current_poll_id uuid REFERENCES polls(id),
  queued_commands jsonb DEFAULT '[]',
  consecutive_failures integer DEFAULT 0,
  last_failure_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trip_sessions_status_phase
  ON trip_sessions(status, phase);
CREATE INDEX IF NOT EXISTS idx_trip_sessions_active
  ON trip_sessions(status) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS idx_trip_sessions_dates_start
  ON trip_sessions((dates->>'start'));
CREATE INDEX IF NOT EXISTS idx_trip_sessions_re_engagement
  ON trip_sessions(re_engagement_sent) WHERE re_engagement_sent = false;
CREATE INDEX IF NOT EXISTS idx_trip_sessions_current_poll
  ON trip_sessions(current_poll_id) WHERE current_poll_id IS NOT NULL;

-- Now add polls.trip_session_id FK (deferred because trip_sessions didn't exist yet)
ALTER TABLE polls ADD COLUMN IF NOT EXISTS trip_session_id uuid REFERENCES trip_sessions(id);

-- 2d. trip_session_participants — per-session participant tracking
CREATE TABLE IF NOT EXISTS trip_session_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_session_id uuid REFERENCES trip_sessions(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id),
  phone text NOT NULL,
  display_name text,
  status text DEFAULT 'active',
  committed boolean NOT NULL DEFAULT false,
  flight_status text DEFAULT 'unknown',
  flights_link_response text,
  origin_city text,
  origin_airport text,
  budget_raw text,
  budget_normalized numeric,
  is_planner boolean DEFAULT false,
  consent_message_sent_at timestamptz,
  joined_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tsp_session
  ON trip_session_participants(trip_session_id);
CREATE INDEX IF NOT EXISTS idx_tsp_user
  ON trip_session_participants(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tsp_session_phone
  ON trip_session_participants(trip_session_id, phone);

-- 2e. trip_session_events — phase transition log
CREATE TABLE IF NOT EXISTS trip_session_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_session_id uuid REFERENCES trip_sessions(id),
  event_type text NOT NULL,
  from_phase text,
  to_phase text,
  triggered_by_user_id uuid REFERENCES users(id),
  triggering_message_sid text,
  metadata jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tse_session
  ON trip_session_events(trip_session_id);

-- 2f. thread_messages — SMS conversation history + idempotency
CREATE TABLE IF NOT EXISTS thread_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id text NOT NULL,
  trip_session_id uuid REFERENCES trip_sessions(id),
  direction text NOT NULL,
  sender_phone text,
  sender_role text DEFAULT 'participant',
  body text,
  message_sid text UNIQUE,
  media_url text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_thread_messages_thread
  ON thread_messages(thread_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_thread_messages_session
  ON thread_messages(trip_session_id, created_at DESC);

-- 2g. scheduled_actions — hype cooldown, queued messages
CREATE TABLE IF NOT EXISTS scheduled_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_session_id uuid REFERENCES trip_sessions(id),
  action_type text NOT NULL,
  execute_at timestamptz NOT NULL,
  executed_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scheduled_actions_pending
  ON scheduled_actions(execute_at) WHERE executed_at IS NULL;

-- 2h. outbound_message_queue — rate-limited send queue
CREATE TABLE IF NOT EXISTS outbound_message_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_session_id uuid REFERENCES trip_sessions(id),
  thread_id text NOT NULL,
  priority integer NOT NULL,
  job_type text DEFAULT 'single',
  body text,
  messages jsonb,
  send_at timestamptz DEFAULT now(),
  sent_at timestamptz,
  retry_count integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_outbound_queue_pending
  ON outbound_message_queue(send_at, priority) WHERE sent_at IS NULL;

-- 2i. trip_access_tokens — signed tokens for trip web view
CREATE TABLE IF NOT EXISTS trip_access_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  trip_session_id uuid REFERENCES trip_sessions(id),
  user_id uuid REFERENCES users(id),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trip_access_tokens_token
  ON trip_access_tokens(token);

-- 2j. split_requests — Venmo split payment tracking
CREATE TABLE IF NOT EXISTS split_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_session_id uuid REFERENCES trip_sessions(id),
  split_type text NOT NULL,
  reason text,
  recipient_user_id uuid REFERENCES users(id),
  payer_user_id uuid REFERENCES users(id),
  amount numeric NOT NULL,
  status text DEFAULT 'pending',
  venmo_link text,
  created_at timestamptz DEFAULT now(),
  paid_confirmed_at timestamptz
);

-- 2k. propose_requests — PROPOSE flow state machine
CREATE TABLE IF NOT EXISTS propose_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_session_id uuid REFERENCES trip_sessions(id),
  proposer_user_id uuid REFERENCES users(id),
  amount numeric NOT NULL,
  per_person_amount numeric,
  reason text,
  participant_count integer,
  status text DEFAULT 'collecting',
  yes_count integer DEFAULT 0,
  no_count integer DEFAULT 0,
  expires_at timestamptz NOT NULL,
  pay_by timestamptz,
  confirmed_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_propose_session_status
  ON propose_requests(trip_session_id, status);
CREATE INDEX IF NOT EXISTS idx_propose_pay_by
  ON propose_requests(pay_by) WHERE status = 'confirmed' AND pay_by IS NOT NULL;

-- 2l. booking_signals — monetization instrumentation
CREATE TABLE IF NOT EXISTS booking_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_session_id uuid REFERENCES trip_sessions(id),
  user_id uuid REFERENCES users(id),
  signal_type text NOT NULL,
  provider text,
  provider_domain text,
  origin text,
  destination text,
  price_per_person numeric,
  total_price numeric,
  booking_url text,
  dates jsonb,
  headcount integer,
  created_at timestamptz DEFAULT now()
);

-- 2m. user_preferences — personalization data layer
CREATE TABLE IF NOT EXISTS user_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) UNIQUE,
  home_airport text,
  preferred_airline text,
  preferred_lodging_platform text,
  preferred_lodging_type text,
  typical_budget_range jsonb,
  past_destinations text[],
  trip_count integer DEFAULT 0,
  updated_at timestamptz DEFAULT now()
);
