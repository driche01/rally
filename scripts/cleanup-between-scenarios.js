#!/usr/bin/env node
/**
 * Marks all active/paused trip sessions as COMPLETE.
 * Called between test scenarios to prevent session state pollution.
 */
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) { console.error("SUPABASE_SERVICE_ROLE_KEY env var required"); process.exit(1); }
const BASE = 'https://qxpbnixvjtwckuedlrfj.supabase.co/rest/v1';

async function cleanup() {
  const res = await fetch(`${BASE}/trip_sessions?status=in.(ACTIVE,PAUSED,RE_ENGAGEMENT_PENDING,FIRST_BOOKING_REACHED)`, {
    method: 'PATCH',
    headers: {
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify({ status: 'COMPLETE' }),
  });
  if (!res.ok) {
    console.error('Cleanup failed:', res.status);
  }
}

cleanup().catch(() => {});
