/**
 * Server-side Supabase client for Next.js App Router.
 *
 * Use this in route handlers, server components, and server actions.
 * Reads + refreshes the auth cookie set by middleware.ts. Honors RLS
 * — never use this for admin operations that need to bypass policies.
 */

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // setAll throws from a Server Component. Safe to ignore — the
            // middleware will refresh the session on the next request.
          }
        },
      },
    },
  );
}

/**
 * Service-role client. Bypasses RLS. Use ONLY in code paths that have
 * already validated the caller (e.g. the SMS scheduler, the mutuals job).
 * NEVER pass user input straight into a service-role query.
 */
export function createServiceClient() {
  // Lazy import to keep this file usable from the edge runtime where
  // service-role isn't typically needed.
  const { createClient } = require("@supabase/supabase-js") as typeof import("@supabase/supabase-js");
  return createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}
