import { Ionicons } from '@expo/vector-icons';
import { Link, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { Button, Input } from '@/components/ui';
import { useGoogleSignIn, useSignUp } from '@/hooks/useAuth';

export default function SignupScreen() {
  const router = useRouter();
  const signUp = useSignUp();
  const googleSignIn = useGoogleSignIn();
  const [googleLoading, setGoogleLoading] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<{
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    password?: string;
  }>({});

  function validate(): boolean {
    const errs: typeof errors = {};
    if (!firstName.trim()) errs.firstName = 'First name is required';
    if (!lastName.trim()) errs.lastName = 'Last name is required';
    if (!email.trim()) errs.email = 'Email is required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) errs.email = 'Enter a valid email address';
    if (!phone.trim()) errs.phone = 'Phone number is required';
    if (!password || password.length < 8) errs.password = 'Password must be at least 8 characters';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleGoogleSignIn() {
    setGoogleLoading(true);
    try {
      const result = await googleSignIn();
      if (result) router.replace('/(app)/(tabs)');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Google sign-in failed.';
      Alert.alert('Sign-in failed', message);
    } finally {
      setGoogleLoading(false);
    }
  }

  async function handleSignup() {
    if (!validate()) return;
    setLoading(true);
    try {
      await signUp(
        firstName.trim(),
        lastName.trim(),
        email.trim().toLowerCase(),
        phone.trim(),
        password,
      );
      router.replace('/(app)/(tabs)');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Signup failed.';
      const isDuplicate = message.toLowerCase().includes('already');
      Alert.alert(
        'Signup failed',
        isDuplicate
          ? 'An account with this email already exists.'
          : message,
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
            Join your group. Big trips ahead.
          </Text>
        </View>

        <View className="gap-4">
          {/* Google sign-in */}
          <Pressable
            onPress={handleGoogleSignIn}
            disabled={googleLoading}
            className="flex-row items-center justify-center gap-3 rounded-xl border border-neutral-200 bg-white py-3.5"
          >
            {googleLoading ? (
              <Text className="text-sm font-medium text-neutral-600">Signing in…</Text>
            ) : (
              <>
                <Ionicons name="logo-google" size={18} color="#4285F4" />
                <Text className="text-sm font-medium text-neutral-700">Continue with Google</Text>
              </>
            )}
          </Pressable>

          {/* Divider */}
          <View className="flex-row items-center gap-3">
            <View className="h-px flex-1 bg-neutral-200" />
            <Text className="text-xs text-neutral-400">or sign up with email</Text>
            <View className="h-px flex-1 bg-neutral-200" />
          </View>

          <View className="flex-row gap-3">
            <View className="flex-1">
              <Input
                label="First name"
                placeholder="Jane"
                value={firstName}
                onChangeText={setFirstName}
                autoComplete="given-name"
                autoCapitalize="words"
                error={errors.firstName}
              />
            </View>
            <View className="flex-1">
              <Input
                label="Last name"
                placeholder="Smith"
                value={lastName}
                onChangeText={setLastName}
                autoComplete="family-name"
                autoCapitalize="words"
                error={errors.lastName}
              />
            </View>
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
            label="Phone number"
            placeholder="+1 555 000 0000"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            autoComplete="tel"
            error={errors.phone}
          />
          <Input
            label="Password"
            placeholder="Min. 8 characters"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="new-password"
            textContentType="oneTimeCode"
            error={errors.password}
          />

          <Button onPress={handleSignup} loading={loading} fullWidth className="mt-2">
            I'm in, let's go
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
