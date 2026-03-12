import { Link, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { Button, Input } from '@/components/ui';
import { useSignIn } from '@/hooks/useAuth';

export default function LoginScreen() {
  const router = useRouter();
  const signIn = useSignIn();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
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
      router.replace('/(app)');
    } catch {
      Alert.alert('Login failed', 'Incorrect email or password.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-neutral-50"
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerClassName="flex-grow justify-center px-6 py-12"
        keyboardShouldPersistTaps="handled"
      >
        {/* Logo / wordmark */}
        <View className="mb-10">
          <Text className="text-4xl font-bold text-coral-500">rally</Text>
          <Text className="mt-1 text-base text-neutral-500">
            Group trip planning, made easy.
          </Text>
        </View>

        <View className="gap-4">
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
            <Text className="text-right text-sm text-coral-500">Forgot password?</Text>
          </Link>

          <Button onPress={handleLogin} loading={loading} fullWidth className="mt-2">
            Log in
          </Button>

          <Link href="/(auth)/magic-link" asChild>
            <Button variant="secondary" fullWidth>
              Log in with magic link
            </Button>
          </Link>
        </View>

        <View className="mt-8 flex-row justify-center gap-1">
          <Text className="text-neutral-500">Don't have an account?</Text>
          <Link href="/(auth)/signup" asChild>
            <Text className="font-medium text-coral-500">Sign up</Text>
          </Link>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
