/**
 * Shared row shapes for the polyglot reminder scheduler.
 * Kept Deno-friendly: no imports from /shared (which is Node-ish TS).
 */

export type ReminderMessageType =
  | 'rsvp_nudge'
  | 'profile_completion_nudge'
  | 'booking_nudge'
  | 'pre_trip_summary'
  | 're_engagement';

export type ReminderStatus =
  | 'pending' | 'sent' | 'cancelled' | 'skipped';

export interface ScheduledReminderRow {
  id:                       string;
  trip_id:                  string;
  recipient_respondent_id:  string;
  message_type:             ReminderMessageType;
  scheduled_for:            string;
  status:                   ReminderStatus;
  sent_thread_message_id:   string | null;
  attempted_at:             string | null;
  skip_reason:              string | null;
}

export interface TripRow {
  id:          string;
  name:        string;
  share_token: string;
  destination: string | null;
  start_date:  string | null;
  end_date:    string | null;
  cancelled_at: string | null;
}

export interface RespondentRow {
  id:                     string;
  trip_id:                string;
  name:                   string;
  phone:                  string | null;
  email:                  string | null;
  is_planner:             boolean;
  rsvp_status:            string | null;
  rsvp_status_updated_at: string | null;
  invited_at:             string | null;
  user_id:                string | null;
}

export interface TripReminderSettingsRow {
  trip_id:                      string;
  rsvp_nudge_enabled:           boolean;
  profile_completion_enabled:   boolean;
  booking_nudge_enabled:        boolean;
  pre_trip_summary_enabled:     boolean;
  re_engagement_enabled:        boolean;
}

/**
 * Defaults applied when a trip has no `trip_reminder_settings` row.
 * Matches the column defaults in migration 139.
 */
export const DEFAULT_REMINDER_SETTINGS: Readonly<Omit<TripReminderSettingsRow, 'trip_id'>> = {
  rsvp_nudge_enabled:           true,
  profile_completion_enabled:   true,
  booking_nudge_enabled:        true,
  pre_trip_summary_enabled:     true,
  re_engagement_enabled:        true,
};

export function settingEnabled(
  s: TripReminderSettingsRow | null | undefined,
  type: ReminderMessageType,
): boolean {
  const row = s ?? { trip_id: '', ...DEFAULT_REMINDER_SETTINGS };
  switch (type) {
    case 'rsvp_nudge':               return row.rsvp_nudge_enabled;
    case 'profile_completion_nudge': return row.profile_completion_enabled;
    case 'booking_nudge':            return row.booking_nudge_enabled;
    case 'pre_trip_summary':         return row.pre_trip_summary_enabled;
    case 're_engagement':            return row.re_engagement_enabled;
  }
}
