/**
 * Fetch interceptor for external API mocking.
 *
 * Intercepts calls to:
 *   - api.anthropic.com (Claude Haiku + Sonnet)
 *   - generativelanguage.googleapis.com (Gemini)
 *   - api.twilio.com (outbound SMS — not needed for inbound testing)
 *
 * Two modes:
 *   - Deterministic (default, no API keys): all calls return canned responses
 *   - Quality (ANTHROPIC_API_KEY set): Claude calls pass through, Gemini mocked
 */

// deno-lint-ignore-file no-explicit-any

const _originalFetch = globalThis.fetch;

/** Install the fetch interceptor. Call before any tests. */
export function installFetchMock(): void {
  globalThis.fetch = mockFetch as typeof globalThis.fetch;
}

/** Remove the fetch interceptor. Call after tests. */
export function uninstallFetchMock(): void {
  globalThis.fetch = _originalFetch;
}

async function mockFetch(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

  // ─── Anthropic (Claude) ─────────────────────────────────────────────────
  if (url.includes('api.anthropic.com')) {
    // If real API key is set, pass through for quality testing
    if (Deno.env.get('ANTHROPIC_API_KEY')) {
      return _originalFetch(input, init);
    }
    return mockAnthropicResponse(url, init);
  }

  // ─── Gemini ─────────────────────────────────────────────────────────────
  if (url.includes('generativelanguage.googleapis.com')) {
    return mockGeminiResponse(url, init);
  }

  // ─── Twilio (outbound) ──────────────────────────────────────────────────
  if (url.includes('api.twilio.com')) {
    return new Response(JSON.stringify({ sid: 'SM_mock_' + Date.now(), status: 'queued' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ─── Everything else: pass through ──────────────────────────────────────
  return _originalFetch(input, init);
}

// ─── Canned Anthropic response ──────────────────────────────────────────────

function mockAnthropicResponse(_url: string, init?: RequestInit): Response {
  let responseText = '{}';

  try {
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
    const systemPrompt = body.system ?? '';
    const lastMessage = body.messages?.[body.messages.length - 1]?.content ?? '';

    // ConversationParser (Haiku) — returns JSON decisions
    if (systemPrompt.includes('group trip planning text thread') || systemPrompt.includes('open decisions')) {
      responseText = JSON.stringify({
        destination_candidates: null,
        destination: null,
        dates: null,
        budget_per_person: null,
        lodging_type: null,
      });
    }
    // BotResponseGenerator (Sonnet) — returns plain text
    else {
      responseText = 'Got it — working on it.';
    }
  } catch {
    responseText = 'Got it — working on it.';
  }

  return new Response(
    JSON.stringify({
      id: 'msg_mock_' + Date.now(),
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: responseText }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 100, output_tokens: 50 },
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    },
  );
}

// ─── Canned Gemini response ─────────────────────────────────────────────────

function mockGeminiResponse(_url: string, init?: RequestInit): Response {
  let content = '{}';

  try {
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
    const prompt = body.contents?.[0]?.parts?.[0]?.text ?? '';

    if (prompt.includes('round-trip economy flight')) {
      content = JSON.stringify({
        low: 280,
        mid: 440,
        high: 650,
        google_flights_url: 'https://www.google.com/travel/flights?q=mock',
      });
    } else if (prompt.includes('vacation rental') || prompt.includes('lodging')) {
      content = JSON.stringify({
        property_name: 'Casa Test Villa',
        total_per_night: 400,
        listing_url: 'https://www.airbnb.com/rooms/mock',
      });
    } else if (prompt.includes('activities') || prompt.includes('experiences')) {
      content = JSON.stringify([
        { name: 'Beach Day', short_description: 'Relax on the beach', approx_cost_per_person: 0, url: 'https://example.com' },
      ]);
    } else if (prompt.includes('restaurant')) {
      content = JSON.stringify([
        { name: 'Test Restaurant', cuisine: 'Mexican', short_description: 'Great tacos', price_range: '$$', url: 'https://example.com' },
      ]);
    }
  } catch {
    // Fall through with empty JSON
  }

  return new Response(
    JSON.stringify({
      candidates: [{
        content: {
          parts: [{ text: content }],
        },
      }],
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    },
  );
}
