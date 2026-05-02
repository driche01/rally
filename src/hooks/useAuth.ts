import { useEffect } from 'react';
import * as WebBrowser from 'expo-web-browser';
import { makeRedirectUri } from 'expo-auth-session';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../stores/authStore';
import { identify, reset } from '../lib/analytics';
import { setUser as setSentryUser, clearUser as clearSentryUser } from '../lib/sentry';
import { registerPushToken, deregisterPushToken } from '../lib/notifications';
import { normalizePhone } from '../lib/phone';

// Required for expo-auth-session to close the browser on web after OAuth redirect
WebBrowser.maybeCompleteAuthSession();

export function useAuthListener() {
  const { setSession, setLoading } = useAuthStore();

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
      if (session?.user) {
        identify(session.user.id, { email: session.user.email });
        setSentryUser(session.user.id, session.user.email);
        registerPushToken();
      }
    });

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      setLoading(false);
      if (session?.user) {
        identify(session.user.id, { email: session.user.email });
        setSentryUser(session.user.id, session.user.email);
        if (event === 'SIGNED_IN') {
          registerPushToken();
        }
      } else {
        // User signed out — reset PostHog identity and remove push token
        reset();
        clearSentryUser();
        deregisterPushToken();
      }
    });

    return () => subscription.unsubscribe();
  }, [setSession, setLoading]);
}

export function useSignUp() {
  return async (
    firstName: string,
    lastName: string,
    email: string,
    phone: string,
    password: string,
  ) => {
    const normalizedPhone = phone ? normalizePhone(phone) : null;

    // Pass the full profile (name + last_name + phone) via auth
    // metadata. The handle_new_user trigger (migration 110) reads
    // these on insert and writes the profiles row server-side, so
    // we don't need a follow-up client upsert — which used to fail
    // when email-confirmation was on (no session → RLS denial).
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          name:      firstName,
          last_name: lastName || null,
          phone:     normalizedPhone ?? phone ?? null,
        },
      },
    });
    if (error) throw error;

    // Phase 3 — phone claim probe.
    // Check whether Rally already has SMS/survey history for this phone
    // that we should offer to merge into the new account. The actual OTP
    // send + claim-phone routing happens in the signup screen so we don't
    // couple the auth hook to navigation. Skipped when there's no
    // session (email-confirm pending) — the RPC requires auth context.
    let claimAvailable = false;
    if (normalizedPhone && data.session) {
      const { data: claimable } = await supabase.rpc('check_claim_available', {
        p_phone: normalizedPhone,
      });
      claimAvailable = claimable === true;
    }

    return { ...data, claimAvailable, normalizedPhone };
  };
}

export function useSignIn() {
  return async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  };
}

export function useSendMagicLink() {
  return async (email: string) => {
    const { error } = await supabase.auth.signInWithOtp({ email });
    if (error) throw error;
  };
}

export function useResetPassword() {
  return async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${process.env.EXPO_PUBLIC_APP_URL}/reset-password`,
    });
    if (error) throw error;
  };
}

export function useSignOut() {
  return async () => {
    await supabase.auth.signOut();
  };
}

/**
 * Trigger the Google OAuth flow.
 *
 * `withCalendarScope` opts in to the additional `calendar.events` scope
 * required for the itinerary → Google Calendar export. Default is off so
 * regular sign-up / sign-in only asks for basic profile + email — adding
 * a sensitive scope to every auth request makes Google reject the whole
 * request when the OAuth consent screen hasn't declared that scope, which
 * would block sign-in entirely. The export flow opts in explicitly when
 * it actually needs Calendar access.
 */
export function useGoogleSignIn() {
  return async (opts: { withCalendarScope?: boolean } = {}) => {
    const redirectTo = makeRedirectUri({ scheme: 'rally', path: 'auth/callback' });

    const oauthOptions: Parameters<typeof supabase.auth.signInWithOAuth>[0]['options'] = {
      redirectTo,
      skipBrowserRedirect: true,
    };
    if (opts.withCalendarScope) {
      oauthOptions.scopes = 'https://www.googleapis.com/auth/calendar.events';
      // access_type=offline + prompt=consent ensures Google issues a
      // refresh token (Supabase exposes it as provider_refresh_token)
      // for future server-side refresh of the Calendar access token.
      oauthOptions.queryParams = { access_type: 'offline', prompt: 'consent' };
    }

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: oauthOptions,
    });
    if (error) throw error;
    if (!data.url) throw new Error('No OAuth URL returned');

    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
    if (result.type !== 'success') return null; // user cancelled

    // exchangeCodeForSession wants just the auth code string, not the full URL.
    // The redirect lands on rally://auth/callback?code=...&state=... — pull
    // the `code` query param out and hand it over.
    const url = new URL(result.url);
    const code = url.searchParams.get('code');
    if (!code) throw new Error('OAuth response missing auth code');

    const { data: sessionData, error: sessionError } =
      await supabase.auth.exchangeCodeForSession(code);
    if (sessionError) throw sessionError;

    // Upsert profile for first-time Google sign-ins (ignored if profile already exists)
    if (sessionData?.user) {
      const meta = sessionData.user.user_metadata ?? {};
      await supabase.from('profiles').upsert(
        {
          id: sessionData.user.id,
          name: meta.given_name || meta.full_name?.split(' ')[0] || '',
          last_name: meta.family_name || null,
          email: sessionData.user.email ?? '',
          phone: null,
        },
        { onConflict: 'id', ignoreDuplicates: true },
      );
    }

    return sessionData;
  };
}
