import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Text, TouchableOpacity, View } from 'react-native';
import { Button, Input } from '@/components/ui';
import { useSendMagicLink } from '@/hooks/useAuth';

export default function MagicLinkScreen() {
  const router = useRouter();
  const sendMagicLink = useSendMagicLink();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  async function handleSend() {
    if (!email.trim()) {
      setError('Email is required');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await sendMagicLink(email.trim().toLowerCase());
      setSent(true);
    } catch {
      setError('Could not send magic link. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-cream"
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View className="flex-1 justify-center px-6 py-12">
        <TouchableOpacity onPress={() => router.back()} className="mb-8" accessibilityRole="button">
          <Text className="text-base text-green">← Back</Text>
        </TouchableOpacity>

        {sent ? (
          <View className="gap-4">
            <Text className="text-2xl font-semibold text-ink">Check your email</Text>
            <Text className="text-base text-muted">
              We sent a magic link to{' '}
              <Text className="font-medium text-ink">{email}</Text>.{'\n\n'}
              Tap the link in the email to log in — no password needed.
            </Text>
          </View>
        ) : (
          <View className="gap-6">
            <View className="gap-1">
              <Text className="text-2xl font-semibold text-ink">Magic link login</Text>
              <Text className="text-base text-muted">
                We'll email you a link to sign in instantly.
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

            <Button onPress={handleSend} loading={loading} fullWidth>
              Send magic link
            </Button>
          </View>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}
