import { Ionicons } from '@expo/vector-icons';
import { Link, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { Button, Input } from '@/components/ui';
import { useGoogleSignIn, useSignIn } from '@/hooks/useAuth';
import { log } from '@/lib/logger';

export default function LoginScreen() {
  const router = useRouter();
  const signIn = useSignIn();
  const googleSignIn = useGoogleSignIn();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});

  function validate(): boolean {
    const errs: typeof errors = {};
    if (!email.trim()) errs.email = 'Email is required';
    if (!password) errs.password = 'Password is required';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleLogin() {
    if (!validate()) return;
    setLoading(true);
    try {
      await signIn(email.trim().toLowerCase(), password);
      log.action('signed_in', { method: 'email' });
      router.replace('/(app)/(tabs)');
    } catch (err) {
      log.error('sign_in_failed', err, { method: 'email' });
      Alert.alert('Login failed', 'Incorrect email or password.');
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogleSignIn() {
    setGoogleLoading(true);
    try {
      const result = await googleSignIn();
      if (result) {
        log.action('signed_in', { method: 'google' });
        router.replace('/(app)/(tabs)');
      }
    } catch (err: unknown) {
      log.error('sign_in_failed', err, { method: 'google' });
      const message = err instanceof Error ? err.message : 'Google sign-in failed.';
      Alert.alert('Sign-in failed', message);
    } finally {
      setGoogleLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-cream"
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerClassName="flex-grow justify-center px-6 py-12"
        keyboardShouldPersistTaps="handled"
      >
        {/* Logo / wordmark */}
        <View className="mb-10">
          <Text
            className="text-5xl font-bold text-green"
            style={{ fontFamily: Platform.OS === 'android' ? 'serif' : 'Georgia' }}
          >
            rally
          </Text>
          <Text className="mt-2 text-base text-muted">
            Gather your group. Plan a great trip.
          </Text>
        </View>

        <View className="gap-4">
          {/* Google sign-in */}
          <Pressable
            onPress={handleGoogleSignIn}
            disabled={googleLoading}
            className="flex-row items-center justify-center gap-3 rounded-md border border-line bg-card py-3.5"
          >
            {googleLoading ? (
              <Text className="text-sm font-medium text-muted">Signing in…</Text>
            ) : (
              <>
                <Ionicons name="logo-google" size={18} color="#4285F4" />
                <Text className="text-sm font-medium text-ink">Continue with Google</Text>
              </>
            )}
          </Pressable>

          {/* Divider */}
          <View className="flex-row items-center gap-3">
            <View className="h-px flex-1 bg-line" />
            <Text className="text-xs text-muted">or</Text>
            <View className="h-px flex-1 bg-line" />
          </View>

          <Input
            label="Email"
            placeholder="you@example.com"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            error={errors.email}
          />
          <Input
            label="Password"
            placeholder="Your password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="password"
            error={errors.password}
          />

          <Link href="/(auth)/forgot-password" asChild>
            <Text className="text-right text-sm text-green">Forgot password?</Text>
          </Link>

          <Button onPress={handleLogin} loading={loading} fullWidth className="mt-2">
            Let's go
          </Button>

        </View>

        <View className="mt-8 flex-row justify-center gap-1">
          <Text className="text-muted">Don't have an account?</Text>
          <Link href="/(auth)/signup" asChild>
            <Text className="font-medium text-green">Sign up</Text>
          </Link>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
