/**
 * Auth-refreshing middleware glue.
 *
 * Called from /web/middleware.ts on every request. Refreshes the
 * Supabase session cookie if needed and forwards the response.
 *
 * If you need to gate routes by auth, do it in the route handler /
 * server component — not here. This file's only job is keeping the
 * session fresh.
 */

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return response; // dev without env shouldn't break

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  // Touch the session — supabase-ssr refreshes the JWT if needed.
  await supabase.auth.getUser();

  return response;
}
