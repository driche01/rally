import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

// On web use default localStorage; on native use expo-secure-store (works in Expo Go)
const storage =
  Platform.OS === 'web'
    ? undefined
    : {
        getItem: (key: string) => SecureStore.getItemAsync(key),
        setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
        removeItem: (key: string) => SecureStore.deleteItemAsync(key),
      };

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: Platform.OS === 'web',
    // PKCE is required for OAuth providers that gate auth-code-flow on a
    // code_challenge (Google in particular). With the default 'implicit'
    // flow, signInWithOAuth wouldn't store a code_verifier, and the
    // exchangeCodeForSession call would 400 with "both auth code and
    // code verifier should be non-empty".
    flowType: 'pkce',
  },
});

// Session-free client used for public share-link queries (respond page).
// Always runs as the anon role regardless of any cached browser session,
// so RLS policies for unauthenticated users apply correctly.
export const supabaseAnon = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});
