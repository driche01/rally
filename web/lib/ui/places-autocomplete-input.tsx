"use client";

/**
 * PlacesAutocompleteInput — React DOM port of the mobile component
 * at src/components/ui/PlacesAutocompleteInput.tsx.
 *
 * Controlled text input with a live Google Places dropdown. Two
 * parallel autocomplete calls per query (geocode + establishment)
 * so cities and venues both surface. 300 ms debounce on keystrokes,
 * 2-char minimum before firing, fresh billing session token after
 * each selection.
 *
 * Three callbacks:
 *   onChangeText(text)                     — every keystroke
 *   onSelectPlace(mainText, fullAddress,   — when the user picks
 *                 placeId)                    a suggestion
 *   onCommit(text)                         — on blur / Enter without
 *                                            having picked (lets the
 *                                            parent save freeform)
 *
 * The mainText (e.g. "Paris") is what we store in the visible value;
 * `fullAddress` ("Paris, France") + `placeId` are the structured
 * payload that callers may persist separately.
 */

import { useEffect, useRef, useState } from "react";
import {
  fetchPlaceSuggestions,
  makePlacesSessionToken,
  type PlaceSuggestion,
} from "@/lib/api/places";

interface Props {
  value: string;
  onChangeText: (v: string) => void;
  /** Fires when the user picks a suggestion. */
  onSelectPlace?: (mainText: string, fullAddress: string, placeId: string) => void;
  /** Fires on blur or Enter when the user typed freeform without picking. */
  onCommit?: (v: string) => void;
  placeholder?: string;
  /** Tailwind classes on the input itself. */
  inputClass?: string;
  /** Tailwind classes on the outer wrapper (relative for dropdown). */
  className?: string;
  /** Hard char limit. */
  maxLength?: number;
  /** Auto-focus on mount. */
  autoFocus?: boolean;
}

export default function PlacesAutocompleteInput({
  value,
  onChangeText,
  onSelectPlace,
  onCommit,
  placeholder = "Search destinations…",
  inputClass = "",
  className = "",
  maxLength,
  autoFocus = false,
}: Props) {
  const [focused,     setFocused]     = useState(false);
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [loading,     setLoading]     = useState(false);
  const [picked,      setPicked]      = useState(false); // suppress "save on blur" after a click
  const sessionTokenRef = useRef(makePlacesSessionToken());
  const timerRef        = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef        = useRef<HTMLInputElement>(null);

  function cap(s: string): string {
    return maxLength ? s.slice(0, maxLength) : s;
  }

  function handleChange(text: string) {
    onChangeText(cap(text));
    setPicked(false);

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

  function handleSelect(s: PlaceSuggestion) {
    const main = cap(s.mainText);
    onChangeText(main);
    onSelectPlace?.(main, s.description, s.id);
    setSuggestions([]);
    setFocused(false);
    setPicked(true);
    // Reset the billing session for the next search.
    sessionTokenRef.current = makePlacesSessionToken();
  }

  function handleBlur() {
    // Defer so a click on a suggestion fires before the dropdown
    // unmounts. The 150ms delay matches the mobile timing.
    setTimeout(() => {
      setFocused(false);
      // If the user typed something but never picked a suggestion,
      // give the parent a chance to save the freeform text.
      if (!picked && onCommit) onCommit(value);
    }, 150);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      const first = suggestions[0];
      if (first) {
        handleSelect(first);
      } else if (onCommit) {
        onCommit(value);
        inputRef.current?.blur();
      }
    } else if (e.key === "Escape") {
      setSuggestions([]);
      inputRef.current?.blur();
    }
  }

  function handleClear() {
    onChangeText("");
    setSuggestions([]);
    setPicked(false);
    sessionTokenRef.current = makePlacesSessionToken();
    inputRef.current?.focus();
  }

  useEffect(() => {
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  const showDropdown = focused && suggestions.length > 0;

  return (
    <div className={`relative ${className}`}>
      {/* Input row */}
      <div className="flex items-center gap-2 rounded-md border border-green bg-card px-2 py-1">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          maxLength={maxLength}
          className={"flex-1 min-w-0 bg-transparent text-ink outline-none placeholder:text-muted " + inputClass}
        />
        {loading ? (
          <span
            aria-hidden
            className="inline-block h-3.5 w-3.5 rounded-full border-2 border-line border-t-green animate-spin"
          />
        ) : value.length > 0 ? (
          <button
            type="button"
            onClick={handleClear}
            onMouseDown={(e) => e.preventDefault()}  // don't steal focus
            aria-label="Clear"
            className="h-5 w-5 rounded-full text-muted hover:text-ink text-xs"
          >
            ×
          </button>
        ) : null}
      </div>

      {/* Suggestions dropdown */}
      {showDropdown && (
        <ul
          role="listbox"
          className="absolute left-0 right-0 top-full mt-1 z-50 overflow-hidden rounded-lg border border-line bg-card shadow-md"
        >
          {suggestions.map((s, i) => (
            <li key={s.id}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                // Use onMouseDown so the click registers before the
                // input's onBlur fires — otherwise the dropdown closes
                // before the click can land.
                onMouseDown={(e) => { e.preventDefault(); handleSelect(s); }}
                className={
                  "w-full text-left px-3 py-2 hover:bg-green-soft/40 flex items-start gap-2 " +
                  (i < suggestions.length - 1 ? "border-b border-line/60" : "")
                }
              >
                <span aria-hidden className="text-muted text-xs mt-0.5">📍</span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm text-ink truncate">{s.mainText}</span>
                  {s.secondaryText && (
                    <span className="block text-xs text-muted truncate">{s.secondaryText}</span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
