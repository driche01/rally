/**
 * API functions for the Planner AI Coach (F2).
 *
 * generate-nudge    — returns prioritized action nudges for the planner dashboard card
 * generate-agent-message — generates an AI SMS draft for a given scenario
 * agent_settings    — stores the planner's auto_remind toggle
 * agent_nudge_log   — records generated/sent messages
 */

import { supabase } from '../supabase';

// ─── Types ─────────────────────────────────────────────────────────────────────

export type NudgeScenario = 'poll_reminder' | 'plan_share' | 'confirmed_group_summary';

export interface Nudge {
  id: string;
  priority: number;
  title: string;
  subtitle: string;
  cta: string;
  ctaTarget: string;
  agentMessageScenario?: NudgeScenario;
}

export interface AgentSettings {
  id: string;
  trip_id: string;
  auto_remind: boolean;
  updated_at: string;
}

export interface AgentNudgeLogEntry {
  id: string;
  trip_id: string;
  scenario: NudgeScenario;
  message_text: string;
  sent_at: string | null;
  created_at: string;
}

// ─── Nudge generation ──────────────────────────────────────────────────────────

export async function getNudges(tripId: string): Promise<Nudge[]> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('No active session');

  const { data, error } = await supabase.functions.invoke('generate-nudge', {
    body: { trip_id: tripId },
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (error) throw error;
  return (data as { nudges: Nudge[] }).nudges ?? [];
}

// ─── Agent message generation ─────────────────────────────────────────────────

export async function generateAgentMessage(
  tripId: string,
  scenario: NudgeScenario
): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('No active session');

  const { data, error } = await supabase.functions.invoke('generate-agent-message', {
    body: { trip_id: tripId, scenario },
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (error) throw error;
  return (data as { message: string }).message ?? '';
}

// ─── Agent settings ────────────────────────────────────────────────────────────

export async function getAgentSettings(tripId: string): Promise<AgentSettings | null> {
  const { data, error } = await supabase
    .from('agent_settings')
    .select('*')
    .eq('trip_id', tripId)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

export async function upsertAgentSettings(
  tripId: string,
  autoRemind: boolean
): Promise<void> {
  const { error } = await supabase
    .from('agent_settings')
    .upsert({ trip_id: tripId, auto_remind: autoRemind }, { onConflict: 'trip_id' });
  if (error) throw error;
}

// ─── Nudge log ─────────────────────────────────────────────────────────────────

export async function logNudgeMessage(
  tripId: string,
  scenario: NudgeScenario,
  messageText: string
): Promise<AgentNudgeLogEntry> {
  const { data, error } = await supabase
    .from('agent_nudge_log')
    .insert({ trip_id: tripId, scenario, message_text: messageText })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function markNudgeSent(nudgeLogId: string): Promise<void> {
  const { error } = await supabase
    .from('agent_nudge_log')
    .update({ sent_at: new Date().toISOString() })
    .eq('id', nudgeLogId);
  if (error) throw error;
}

export async function getRecentNudgeLogs(
  tripId: string
): Promise<AgentNudgeLogEntry[]> {
  const { data, error } = await supabase
    .from('agent_nudge_log')
    .select('*')
    .eq('trip_id', tripId)
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) throw error;
  return data ?? [];
}
