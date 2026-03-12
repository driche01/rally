import { Link, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { Button, Input } from '@/components/ui';
import { useSignUp } from '@/hooks/useAuth';

export default function SignupScreen() {
  const router = useRouter();
  const signUp = useSignUp();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<{ name?: string; email?: string; password?: string }>({});

  function validate(): boolean {
    const errs: typeof errors = {};
    if (!name.trim()) errs.name = 'Name is required';
    if (!email.trim()) errs.email = 'Email is required';
    if (!password || password.length < 8) errs.password = 'Password must be at least 8 characters';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSignup() {
    if (!validate()) return;
    setLoading(true);
    try {
      await signUp(name.trim(), email.trim().toLowerCase(), password);
      router.replace('/(app)');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Signup failed.';
      const isDuplicate = message.toLowerCase().includes('already');
      Alert.alert(
        'Signup failed',
        isDuplicate
          ? 'An account with this email already exists.'
          : message
      );
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
        <View className="mb-10">
          <Text className="text-4xl font-bold text-coral-500">rally</Text>
          <Text className="mt-1 text-base text-neutral-500">
            Create your account to start planning.
          </Text>
        </View>

        <View className="gap-4">
          <Input
            label="Your name"
            placeholder="First name"
            value={name}
            onChangeText={setName}
            autoComplete="given-name"
            autoCapitalize="words"
            error={errors.name}
          />
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
            placeholder="Min. 8 characters"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="new-password"
            error={errors.password}
          />

          <Button onPress={handleSignup} loading={loading} fullWidth className="mt-2">
            Create account
          </Button>
        </View>

        <View className="mt-8 flex-row justify-center gap-1">
          <Text className="text-neutral-500">Already have an account?</Text>
          <Link href="/(auth)/login" asChild>
            <Text className="font-medium text-coral-500">Log in</Text>
          </Link>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
