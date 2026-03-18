// expo-iap requires a native build — stubbed for Expo Go compatibility
import { View, Text } from 'react-native';

export default function PaywallScreen() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Text>Paywall (requires native build)</Text>
    </View>
  );
}
