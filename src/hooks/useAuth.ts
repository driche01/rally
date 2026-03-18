import { useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../stores/authStore';
import { identify, reset } from '../lib/analytics';

export function useAuthListener() {
  const { setSession, setLoading } = useAuthStore();

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
      if (session?.user) {
        identify(session.user.id, { email: session.user.email });
      }
    });

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setLoading(false);
      if (session?.user) {
        identify(session.user.id, { email: session.user.email });
      } else {
        // User signed out — reset PostHog identity
        reset();
      }
    });

    return () => subscription.unsubscribe();
  }, [setSession, setLoading]);
}

export function useSignUp() {
  return async (firstName: string, lastName: string, email: string, phone: string, password: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { name: firstName } },
    });
    if (error) throw error;

    // Create profile immediately (session is available when email confirmation is off)
    if (data.user) {
      const { error: profileError } = await supabase
        .from('profiles')
        .upsert({ id: data.user.id, name: firstName, last_name: lastName, email, phone });
      if (profileError) throw profileError;
    }

    return data;
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
