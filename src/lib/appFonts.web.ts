import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from '@expo-google-fonts/inter';

// Web entry points (landing, respond) never reference SpaceGrotesk —
// the few authenticated screens that do fall back to system serif on
// web. Skipping the import here keeps ~660 KB of font binaries out of
// the web bundle entirely.
export function useAppFonts() {
  const [loaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });
  return loaded;
}
