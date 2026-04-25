/**
 * PlacesAutocompleteInput
 *
 * A controlled text input that shows a live Google Places autocomplete
 * dropdown as the user types. Falls back to POPULAR_DESTINATIONS when no
 * API key is configured.
 *
 * Usage:
 *   <PlacesAutocompleteInput
 *     value={destination}
 *     onChangeText={setDestination}
 *     placeholder="e.g. Cancun, Bali, Tokyo…"
 *     leadingIcon
 *   />
 */

import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleProp,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';
import { fetchPlaceSuggestions, PlaceSuggestion } from '@/lib/api/places';
import { T } from '@/theme';

// Placeholder text + secondary icon tint — slightly desaturated against
// the warm card surface. Local-only (not part of brand T).
const PLACEHOLDER = '#9DA8A0';

function makeSessionToken() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

interface Props {
  value: string;
  onChangeText: (v: string) => void;
  /**
   * Called when the user picks a suggestion from the dropdown.
   * Receives the short display name (mainText) and the full address string.
   * Use this to separately store the address for map deep-links.
   */
  onSelectPlace?: (mainText: string, fullAddress: string) => void;
  placeholder?: string;
  /** Hard character limit applied on change and on selection */
  maxLength?: number;
  /** Show a leading location-pin icon inside the input row */
  leadingIcon?: boolean;
  /** Additional style on the outermost wrapper View */
  containerStyle?: StyleProp<ViewStyle>;
}

export function PlacesAutocompleteInput({
  value,
  onChangeText,
  onSelectPlace,
  placeholder = 'Search destinations…',
  maxLength,
  leadingIcon = false,
  containerStyle,
}: Props) {
  const [focused, setFocused] = useState(false);
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const sessionTokenRef = useRef(makeSessionToken());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function cap(s: string) {
    return maxLength ? s.slice(0, maxLength) : s;
  }

  function handleChange(text: string) {
    onChangeText(cap(text));

    if (timerRef.current) clearTimeout(timerRef.current);

    if (!text.trim() || text.trim().length < 2) {
      setSuggestions([]);
      return;
    }

    timerRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const results = await fetchPlaceSuggestions(text, sessionTokenRef.current);
        setSuggestions(results);
      } finally {
        setLoading(false);
      }
    }, 300);
  }

  function handleSelect(suggestion: PlaceSuggestion) {
    // Store display name (mainText) as the value, e.g. "Dawn Ranch"
    onChangeText(cap(suggestion.mainText));
    // Give the full address to the parent if it wants to store it separately
    onSelectPlace?.(cap(suggestion.mainText), suggestion.description);
    setSuggestions([]);
    setFocused(false);
    // Reset session token after a selection (Google billing best-practice)
    sessionTokenRef.current = makeSessionToken();
  }

  function handleClear() {
    onChangeText('');
    setSuggestions([]);
    sessionTokenRef.current = makeSessionToken();
  }

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const showDropdown = focused && suggestions.length > 0;

  return (
    <View style={containerStyle}>
      {/* Input row */}
      <View className="flex-row items-center min-h-[48px] rounded-md border border-line bg-card px-4 py-3">
        {leadingIcon && (
          <Ionicons
            name="location-outline"
            size={18}
            color={T.muted}
            style={{ marginRight: 8 }}
          />
        )}
        <TextInput
          value={value}
          onChangeText={handleChange}
          placeholder={placeholder}
          maxLength={maxLength}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          placeholderTextColor={PLACEHOLDER}
          returnKeyType="done"
          className="flex-1 text-base text-ink"
        />
        {loading ? (
          <ActivityIndicator size="small" color={T.muted} style={{ marginLeft: 6 }} />
        ) : value.length > 0 ? (
          <TouchableOpacity hitSlop={8} onPress={handleClear}>
            <Ionicons name="close-circle" size={18} color={T.muted} />
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Suggestions dropdown */}
      {showDropdown && (
        <View className="mt-1 overflow-hidden rounded-lg border border-line bg-card shadow-sm">
          {suggestions.map((s, i) => (
            <Pressable
              key={s.id}
              onPress={() => handleSelect(s)}
              className={[
                'flex-row items-center gap-3 px-4 py-3',
                i < suggestions.length - 1 ? 'border-b border-line' : '',
              ].join(' ')}
            >
              <Ionicons name="location-outline" size={15} color={T.muted} />
              <View className="flex-1">
                <Text className="text-sm font-medium text-ink" numberOfLines={1}>
                  {s.mainText}
                </Text>
                {s.secondaryText ? (
                  <Text className="text-xs text-muted" numberOfLines={1}>
                    {s.secondaryText}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}
