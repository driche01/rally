/**
 * Privacy Policy — served as a public web page at /privacy
 * Required for App Store submission.
 */
import { ScrollView, Text, View } from 'react-native';

const LAST_UPDATED = 'March 2026';
const CONTACT_EMAIL = 'hello@rallyapp.io';

export default function PrivacyPolicyPage() {
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: '#FAFAFA' }}
      contentContainerStyle={{ maxWidth: 680, alignSelf: 'center', width: '100%', paddingHorizontal: 24, paddingVertical: 48 }}
    >
      <Text style={{ fontSize: 11, fontWeight: '600', color: '#D85A30', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>
        Rally App
      </Text>
      <Text style={{ fontSize: 32, fontWeight: '800', color: '#1C1C1C', marginBottom: 6 }}>
        Privacy Policy
      </Text>
      <Text style={{ fontSize: 13, color: '#737373', marginBottom: 40 }}>
        Last updated: {LAST_UPDATED}
      </Text>

      <Section title="Overview">
        Rally ("we", "us", or "our") is a group trip planning app. This policy explains what data we collect, how we use it, and your rights. By using Rally, you agree to this policy.
      </Section>

      <Section title="Information We Collect">
        <BulletItem label="Account data">Your name, email address, and phone number when you create an account or respond to a trip invite.</BulletItem>
        <BulletItem label="Trip data">Trip names, destinations, dates, group preferences, poll responses, itinerary items, and expenses you create within the app.</BulletItem>
        <BulletItem label="Location data">Your approximate location during an active trip, if you choose to share it with your group. Location is only collected when the app is in the foreground and only when you explicitly enable sharing.</BulletItem>
        <BulletItem label="Usage data">How you interact with the app (screens visited, features used) via PostHog analytics, to help us improve the product.</BulletItem>
        <BulletItem label="Device data">Push notification tokens, device type, and OS version, used to deliver notifications.</BulletItem>
        <BulletItem label="Error data">Crash reports and error logs via Sentry, to help us fix bugs. These may include device info and app state at the time of the error.</BulletItem>
      </Section>

      <Section title="How We Use Your Data">
        <BulletItem>Provide and operate the Rally service</BulletItem>
        <BulletItem>Send push notifications about trip activity (only with your permission)</BulletItem>
        <BulletItem>Share your location with your trip group (only when you opt in)</BulletItem>
        <BulletItem>Improve app performance and fix bugs</BulletItem>
        <BulletItem>Communicate with you about your account</BulletItem>
      </Section>

      <Section title="Data Sharing">
        We do not sell your personal data. We share data only with:
        <BulletItem label="Supabase">Our database and authentication provider. Trip data is stored here.</BulletItem>
        <BulletItem label="PostHog">Analytics, to understand app usage patterns. Data is anonymised where possible.</BulletItem>
        <BulletItem label="Sentry">Error monitoring. Crash reports may include your user ID.</BulletItem>
        <BulletItem label="Expo / EAS">App delivery infrastructure.</BulletItem>
        We may disclose data if required by law.
      </Section>

      <Section title="Location Data">
        Location sharing is entirely opt-in. You can turn it on or off at any time from within a trip. When enabled, your location is visible only to members of that specific trip. We do not store historical location data — only your current position is shared in real time.
      </Section>

      <Section title="Data Retention">
        We retain your account and trip data while your account is active. You can delete your account at any time by contacting us at {CONTACT_EMAIL}. Trip data is deleted within 30 days of account deletion.
      </Section>

      <Section title="Your Rights">
        Depending on where you live, you may have the right to access, correct, or delete the personal data we hold about you. Contact us at {CONTACT_EMAIL} to make a request.
      </Section>

      <Section title="Children">
        Rally is not intended for children under 13. We do not knowingly collect data from children under 13.
      </Section>

      <Section title="Changes to This Policy">
        We may update this policy from time to time. We'll notify you of significant changes via the app or email. Continued use of Rally after changes constitutes acceptance.
      </Section>

      <Section title="Contact">
        Questions? Email us at {CONTACT_EMAIL}.
      </Section>
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: 28 }}>
      <Text style={{ fontSize: 18, fontWeight: '700', color: '#1C1C1C', marginBottom: 8 }}>
        {title}
      </Text>
      <Text style={{ fontSize: 15, color: '#404040', lineHeight: 24 }}>
        {children}
      </Text>
    </View>
  );
}

function BulletItem({ label, children }: { label?: string; children: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', marginTop: 6, gap: 6 }}>
      <Text style={{ fontSize: 15, color: '#737373', lineHeight: 24 }}>{'•'}</Text>
      <Text style={{ flex: 1, fontSize: 15, color: '#404040', lineHeight: 24 }}>
        {label ? <Text style={{ fontWeight: '600' }}>{label}: </Text> : null}
        {children}
      </Text>
    </View>
  );
}
