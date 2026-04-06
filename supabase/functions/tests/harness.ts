/**
 * TestHarness — runs SMS bot scenarios against the in-memory mock.
 *
 * Usage:
 *   const h = new TestHarness();
 *   h.setup();
 *   const reply = await h.sendMessage('+15551110001', 'Jake — Tulum');
 *   assertEquals(h.getPhase(), 'INTRO');
 *   h.teardown();
 */

import { InMemorySupabase } from './mock-supabase.ts';
import { installFetchMock, uninstallFetchMock } from './mock-apis.ts';
import { _setAdminForTesting } from '../_sms-shared/supabase.ts';
import { processInboundMessage } from '../_sms-shared/inbound-processor.ts';
import type { ParsedTwilioMessage } from '../_sms-shared/inbound-processor.ts';

// deno-lint-ignore-file no-explicit-any

const RALLY_PHONE = '+18559310010';
const ALL_RALLY_PHONES = [RALLY_PHONE, '+16624283059'];

export interface MessageResult {
  response: string | null;
  sessionId: string | null;
  phase: string | null;
}

export class TestHarness {
  db: InMemorySupabase;
  responses: MessageResult[] = [];
  private msgCounter = 0;

  constructor() {
    this.db = new InMemorySupabase();
  }

  /** Call before each test */
  setup(): void {
    this.db.reset();
    this.responses = [];
    this.msgCounter = 0;
    _setAdminForTesting(this.db as any);
    installFetchMock();

    // Set env vars the bot expects
    Deno.env.set('TWILIO_PHONE_NUMBER', RALLY_PHONE);
    // Leave ANTHROPIC_API_KEY and GEMINI_API_KEY unset for deterministic mode
  }

  /** Call after each test */
  teardown(): void {
    uninstallFetchMock();
  }

  /**
   * Send one message through the full pipeline.
   * Use `MM` prefix for group MMS (default), `SM` for 1:1.
   */
  async sendMessage(
    from: string,
    body: string,
    opts?: { is1to1?: boolean },
  ): Promise<MessageResult> {
    this.msgCounter++;
    const sid = opts?.is1to1
      ? `SM_test_${this.msgCounter}_${Date.now()}`
      : `MM_test_${this.msgCounter}_${Date.now()}`;

    const msg: ParsedTwilioMessage = {
      MessageSid: sid,
      From: from,
      To: `${RALLY_PHONE},${from}`,
      Body: body,
      NumMedia: '0',
    };

    const result = await processInboundMessage(this.db as any, msg, ALL_RALLY_PHONES);
    this.responses.push(result);
    return result;
  }

  /**
   * Send a 1:1 message (planner pre-registration).
   */
  async send1to1(from: string, body: string): Promise<MessageResult> {
    return this.sendMessage(from, body, { is1to1: true });
  }

  /**
   * Replay a fixture JSON file.
   * Returns all responses in order.
   */
  async replayFixture(fixturePath: string): Promise<MessageResult[]> {
    const raw = await Deno.readTextFile(fixturePath);
    const fixture = JSON.parse(raw);
    const results: MessageResult[] = [];

    for (const msg of fixture.messages) {
      // Detect 1:1 by checking if the _note mentions it or if it's the first message
      // and from the planner with body "Hey" (common pattern in fixtures)
      const is1to1 = msg._note?.includes('1:1') ?? false;

      const result = is1to1
        ? await this.send1to1(msg.from, msg.body)
        : await this.sendMessage(msg.from, msg.body);

      results.push(result);
    }

    return results;
  }

  // ─── Inspectors ───────────────────────────────────────────────────────

  /** Get the current session (most recent active) */
  getSession(): any | null {
    const sessions = this.db.dump('trip_sessions');
    return sessions.find((s) => s.status === 'ACTIVE') ?? sessions[sessions.length - 1] ?? null;
  }

  /** Get current phase */
  getPhase(): string | null {
    return this.getSession()?.phase ?? null;
  }

  /** Get all participants for the current session */
  getParticipants(): any[] {
    const session = this.getSession();
    if (!session) return [];
    return this.db.dump('trip_session_participants').filter((p) => p.trip_session_id === session.id);
  }

  /** Get named participants */
  getNamedParticipants(): any[] {
    return this.getParticipants().filter((p) => p.display_name);
  }

  /** Get all outbound messages */
  getOutboundMessages(): string[] {
    return this.db.dump('thread_messages')
      .filter((m) => m.direction === 'outbound')
      .map((m) => m.body as string);
  }

  /** Get all inbound messages */
  getInboundMessages(): string[] {
    return this.db.dump('thread_messages')
      .filter((m) => m.direction === 'inbound')
      .map((m) => m.body as string);
  }

  /** Get the last bot response */
  getLastResponse(): string | null {
    const responses = this.responses.filter((r) => r.response !== null);
    return responses[responses.length - 1]?.response ?? null;
  }

  /** Check if any outbound message contains a pattern */
  outboundContains(pattern: string): boolean {
    return this.getOutboundMessages().some(
      (m) => m.toLowerCase().includes(pattern.toLowerCase()),
    );
  }

  /** Check that no outbound message contains a pattern */
  outboundDoesNotContain(pattern: string): boolean {
    return !this.outboundContains(pattern);
  }
}
