/**
 * POST /api/account/promote-from-session
 *
 * Promotes a cookie-only respondent (someone who's RSVPed but never
 * gone through OTP) into a fully Supabase-authed user, so they can
 * use the rest of the app — create trips, view their profile, etc.
 * — without a second SMS step.
 *
 * Flow:
 *   1. Read the `rally_session_token` cookie set by /api/invite/[token]/rsvp.
 *   2. Resolve the respondent row → phone + name.
 *   3. Ensure a profiles row exists for this phone. If the profile
 *      already has email + auth.users linkage (e.g. the respondent
 *      was already a planner under another phone), reuse it.
 *      Otherwise create a fresh auth.user (admin.createUser) and a
 *      matching profiles row. Synthetic email format
 *      `rally-<digits>@invalid.local` — never receives mail, just
 *      satisfies the auth.users.email NOT NULL + unique constraints
 *      and gives admin.generateLink something to key on.
 *   4. Generate a magiclink token_hash for that email.
 *   5. Return { token_hash } — caller exchanges it on the client via
 *      supabase.auth.verifyOtp({ type: 'magiclink', token_hash })
 *      which sets the Supabase session cookies.
 *
 * Security note: a respondent's identity is "verified" only insofar
 * as they possess the invite URL + a phone they typed at RSVP. An
 * attacker who has both could squat the account. When the real
 * owner later runs the OTP login flow with the same phone, they
 * reclaim it (phone OTP is the authoritative identity check). For
 * the alpha cohort (whitelisted phones) the surface is acceptable;
 * post-alpha we'll harden with phone-OTP at RSVP.
 */

import { cookies } from "next/headers";
import { createServiceClient } from "@/lib/supabase/server";
import { jsonErr, jsonOk } from "@/lib/http";

const COOKIE_NAME = "rally_session_token";

export async function POST() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(COOKIE_NAME)?.value ?? null;
  if (!sessionToken) return jsonErr(401, "no_session_cookie");

  const svc = createServiceClient();

  // 1. Find the most recent respondent row for this session token.
  //    Same row the AppHeader reads to render the respondent chip.
  const { data: respondent, error: respErr } = await svc
    .from("respondents")
    .select("id, phone, name, first_name, last_name, user_id")
    .eq("session_token", sessionToken)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (respErr) return jsonErr(500, "respondent_lookup_failed", respErr.message);
  if (!respondent || !respondent.phone) {
    return jsonErr(404, "no_respondent_for_session");
  }

  const phone = respondent.phone;
  const fullName =
    [respondent.first_name, respondent.last_name].filter(Boolean).join(" ").trim()
    || respondent.name
    || "Friend";

  // 2. Look up an existing phone-keyed profile.
  const { data: existingProfile } = await svc
    .from("profiles")
    .select("id, email, phone")
    .eq("phone", phone)
    .maybeSingle();

  let authUserId: string;
  let email: string;

  if (existingProfile?.email) {
    // Already provisioned — reuse the auth user.
    authUserId = existingProfile.id;
    email = existingProfile.email;
  } else {
    // Need to provision. Build a deterministic synthetic email so
    // multiple promotion attempts for the same phone collide rather
    // than creating duplicates.
    const digits = phone.replace(/\D+/g, "");
    email = `rally-${digits}@invalid.local`;

    // Did an auth.user with this email already exist (e.g. from a
    // prior promotion attempt that failed before profile creation)?
    // listUsers paginates; for one specific email a direct query
    // would be ideal but the JS SDK doesn't expose that — listUsers
    // with a small page is good enough at alpha scale.
    const { data: existingAuthUser } = await findAuthUserByEmail(svc, email);

    if (existingAuthUser) {
      authUserId = existingAuthUser.id;
    } else {
      const { data: created, error: createErr } = await svc.auth.admin.createUser({
        email,
        phone,
        email_confirm: true,
        phone_confirm: true,
        user_metadata: { name: fullName },
      });
      if (createErr || !created.user) {
        return jsonErr(500, "auth_user_create_failed", createErr?.message);
      }
      authUserId = created.user.id;
    }

    // 3. Ensure the profiles row matches. The signup trigger may
    //    have created it from auth metadata already; if not, insert.
    const { data: profileAfter } = await svc
      .from("profiles")
      .select("id")
      .eq("id", authUserId)
      .maybeSingle();
    if (!profileAfter) {
      // Split fullName into first/last for the profiles row.
      const parts = fullName.split(/\s+/);
      const firstName = parts[0];
      const lastName  = parts.slice(1).join(" ") || null;
      const { error: insertErr } = await svc
        .from("profiles")
        .insert({
          id:    authUserId,
          name:  firstName,
          last_name: lastName,
          email,
          phone,
        });
      if (insertErr) return jsonErr(500, "profile_insert_failed", insertErr.message);
    } else {
      // Profile already exists — backfill phone if missing.
      await svc.from("profiles").update({ phone }).eq("id", authUserId).is("phone", null);
    }
  }

  // 4. Backfill the respondent + users tables so future requests
  //    resolve the relationship without a phone fallback. Also
  //    capture the users.id we'll return to the client so a
  //    "profile" click can route directly to /user/<id> instead of
  //    bouncing through /trips.
  let usersId: string | null = respondent.user_id;
  if (usersId) {
    await svc.from("users").update({ auth_user_id: authUserId }).eq("id", usersId).is("auth_user_id", null);
  } else {
    const { data: existingUser } = await svc.from("users").select("id, auth_user_id").eq("phone", phone).maybeSingle();
    if (existingUser) {
      usersId = existingUser.id;
      await svc.from("users").update({ auth_user_id: authUserId }).eq("id", existingUser.id).is("auth_user_id", null);
      await svc.from("respondents").update({ user_id: existingUser.id }).eq("id", respondent.id);
    }
  }

  // 5. Mint the magic-link token_hash. The client exchanges it via
  //    supabase.auth.verifyOtp({ type: 'magiclink', token_hash }).
  const { data: link, error: linkErr } = await svc.auth.admin.generateLink({
    type:  "magiclink",
    email,
  });
  if (linkErr || !link?.properties?.hashed_token) {
    return jsonErr(500, "magiclink_generate_failed", linkErr?.message);
  }

  return jsonOk({
    token_hash: link.properties.hashed_token,
    email,
    users_id: usersId,
  });
}

// ─── helpers ─────────────────────────────────────────────────────

async function findAuthUserByEmail(
  svc: ReturnType<typeof createServiceClient>,
  email: string,
): Promise<{ data: { id: string } | null }> {
  // listUsers's pagination tops at 1000 per page; for the alpha
  // cohort one page is enough. Switch to a direct admin lookup once
  // supabase-js adds one.
  const { data, error } = await svc.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error || !data?.users) return { data: null };
  const hit = data.users.find((u) => u.email === email);
  return { data: hit ? { id: hit.id } : null };
}
