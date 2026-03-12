import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Text, TouchableOpacity, View } from 'react-native';
import { Button, Input } from '@/components/ui';
import { useResetPassword } from '@/hooks/useAuth';

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const resetPassword = useResetPassword();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  async function handleReset() {
    if (!email.trim()) {
      setError('Email is required');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await resetPassword(email.trim().toLowerCase());
      setSent(true);
    } catch {
      setError('Could not send reset link. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-neutral-50"
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View className="flex-1 justify-center px-6 py-12">
        <TouchableOpacity
          onPress={() => router.back()}
          className="mb-8"
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Text className="text-base text-coral-500">← Back</Text>
        </TouchableOpacity>

        {sent ? (
          <View className="gap-4">
            <Text className="text-2xl font-semibold text-neutral-800">Check your email</Text>
            <Text className="text-base text-neutral-500">
              We sent a reset link to{' '}
              <Text className="font-medium text-neutral-700">{email}</Text>.
            </Text>
            <Button variant="secondary" onPress={() => router.replace('/(auth)/login')} fullWidth>
              Back to login
            </Button>
          </View>
        ) : (
          <View className="gap-6">
            <View className="gap-1">
              <Text className="text-2xl font-semibold text-neutral-800">Reset password</Text>
              <Text className="text-base text-neutral-500">
                Enter your email and we'll send you a reset link.
              </Text>
            </View>

            <Input
              label="Email"
              placeholder="you@example.com"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              error={error}
            />

            <Button onPress={handleReset} loading={loading} fullWidth>
              Send reset link
            </Button>
          </View>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}
