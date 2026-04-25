#!/usr/bin/env node
/**
 * ConversationSimulator — test harness for the SMS agent.
 *
 * Replays scripted message sequences against the real webhook endpoint.
 * Asserts on outbound messages and phase transitions.
 *
 * Usage:
 *   node scripts/simulate.js --script scripts/fixtures/happy_path.json
 *   node scripts/simulate.js --script scripts/fixtures/happy_path.json --base-url http://localhost:54321
 */
const fs = require('fs');

// Parse args
const args = process.argv.slice(2);
const scriptIdx = args.indexOf('--script');
const baseUrlIdx = args.indexOf('--base-url');

if (scriptIdx === -1 || !args[scriptIdx + 1]) {
  console.error('Usage: node scripts/simulate.js --script <path>');
  process.exit(1);
}

const scriptPath = args[scriptIdx + 1];
const BASE_URL = baseUrlIdx !== -1 ? args[baseUrlIdx + 1] : (process.env.RALLY_BASE_URL || 'https://qxpbnixvjtwckuedlrfj.supabase.co/functions/v1');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '***SCRUBBED-SUPABASE-SERVICE-ROLE-KEY***';
const RALLY_PHONE = process.env.TWILIO_PHONE_NUMBER || '+18559310010';

const script = JSON.parse(fs.readFileSync(scriptPath, 'utf8'));

// Phase 2 of 1:1 pivot: scenarios written for the old group-MMS routing are
// tagged `_obsolete: true`. Skip by default; --include-obsolete to force.
const includeObsolete = args.includes('--include-obsolete');
if (script._obsolete && !includeObsolete) {
  console.log(`\n⏭️  Skipped (obsolete under 1:1 model): ${script.script_name}`);
  console.log(`   Pass --include-obsolete to run anyway.\n`);
  process.exit(0);
}

const outboundMessages = [];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseTwiml(xml) {
  const match = xml.match(/<Message>(.*?)<\/Message>/s);
  if (!match) return null;
  return match[1]
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"');
}

async function sendMessage(from, body, phones, opts = {}) {
  // Build To field: Rally + all other participants
  const others = phones.filter((p) => p !== from);
  const to = [RALLY_PHONE, ...others].join(',');

  // Use MM prefix for group MMS, SM for 1:1 — the bot checks this to distinguish
  const sidPrefix = opts.is1to1 ? 'SM' : 'MM';
  const params = new URLSearchParams({
    MessageSid: `${sidPrefix}_sim_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    From: from,
    To: to,
    Body: body,
    NumMedia: '0',
  });

  // Retry with backoff on transient errors
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 60_000); // 60s timeout
      const res = await fetch(`${BASE_URL}/sms-inbound`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Bearer ${SERVICE_KEY}`,
        },
        body: params.toString(),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!res.ok) {
        console.error(`  FAIL: ${body} → HTTP ${res.status}`);
        process.exit(1);
      }

      const xml = await res.text();
      const reply = parseTwiml(xml);

      if (reply) outboundMessages.push(reply);

      return reply;
    } catch (err) {
      lastErr = err;
      if (attempt < 2) await sleep(1000 * (attempt + 1));
    }
  }
  console.error(`  FAIL after 3 retries: ${body}`, lastErr);
  process.exit(1);
}

async function run() {
  console.log(`\n🚀 Running: ${script.script_name}\n`);

  // Determine all participant phones
  const phones = script.phones
    ? Object.values(script.phones).filter((p) => p !== RALLY_PHONE)
    : [...new Set(script.messages.map((m) => m.from))];

  // Send messages in sequence
  for (const msg of script.messages) {
    // Minimum 500ms between messages, cap at 5s
    const delay = Math.max(Math.min(msg.delay_ms || 500, 5000), 500);
    await sleep(delay);

    // Detect 1:1 messages (planner pre-registration) from the _note field
    const is1to1 = msg._note?.includes('1:1') || msg._is1to1 || false;
    const reply = await sendMessage(msg.from, msg.body, phones, { is1to1 });

    const tag = msg.from.slice(-4);
    console.log(`  [${tag}] ${msg.body}`);
    if (reply) console.log(`    → ${reply}`);
  }

  console.log(`\n--- Outbound messages collected: ${outboundMessages.length} ---\n`);

  // Assert outbound_contains
  let passed = true;
  if (script.assert_outbound_contains) {
    for (const pattern of script.assert_outbound_contains) {
      const found = outboundMessages.some((m) =>
        m.toLowerCase().includes(pattern.toLowerCase()),
      );
      if (found) {
        console.log(`  ✅ Found: "${pattern}"`);
      } else {
        console.log(`  ❌ MISSING: "${pattern}"`);
        passed = false;
      }
    }
  }

  if (script.assert_outbound_does_not_contain) {
    for (const pattern of script.assert_outbound_does_not_contain) {
      const found = outboundMessages.some((m) =>
        m.toLowerCase().includes(pattern.toLowerCase()),
      );
      if (found) {
        console.log(`  ❌ SHOULD NOT CONTAIN: "${pattern}"`);
        passed = false;
      } else {
        console.log(`  ✅ Correctly absent: "${pattern}"`);
      }
    }
  }

  console.log('');
  if (passed) {
    console.log(`✅ ${script.script_name} passed\n`);
  } else {
    console.log(`❌ ${script.script_name} FAILED`);
    console.log('\nActual outbound:');
    outboundMessages.forEach((m, i) => console.log(`  ${i + 1}. ${m.slice(0, 150)}`));
    process.exit(1);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
