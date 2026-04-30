#!/usr/bin/env node
/**
 * Manually invoke the sms-nudge-scheduler edge function.
 *
 * Useful between e2e test scenarios so you don't wait for the next
 * 15-min cron tick. The function verifies JWT, so we send the
 * service-role key in the Authorization header (mirroring the cron in
 * migration 055).
 *
 *   node scripts/poke-scheduler.js
 */
const SUPABASE_URL = 'https://qxpbnixvjtwckuedlrfj.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY env var required'); process.exit(1);
}

async function main() {
  const start = Date.now();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/sms-nudge-scheduler`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SERVICE_KEY}`,
    },
    body: '{}',
  });
  const elapsed = Date.now() - start;
  const json = await res.json().catch(() => null);
  if (!json) {
    console.error(`HTTP ${res.status} (${elapsed}ms): ${await res.text()}`);
    process.exit(1);
  }
  console.log(`Scheduler responded in ${elapsed}ms:`);
  console.log(JSON.stringify(json, null, 2));
  if (!json.ok) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
