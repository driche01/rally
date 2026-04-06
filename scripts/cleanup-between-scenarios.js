#!/usr/bin/env node
/**
 * Marks all active/paused trip sessions as COMPLETE.
 * Called between test scenarios to prevent session state pollution.
 */
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF4cGJuaXh2anR3Y2t1ZWRscmZqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzIwMDI0MywiZXhwIjoyMDg4Nzc2MjQzfQ.ZBkGoUbavzMkiHcN_FQt38GbbMCx2PKbYyZd2hau_28';
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
