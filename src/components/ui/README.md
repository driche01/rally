# Rally Design System

Single source of truth for every UI element in the app. **Always import from `@/components/ui`** — never roll your own `<Pressable>` / `<TextInput>` / inline Tailwind for things this directory already covers. When the brand updates, the whole app updates with it.

## Color tokens

Brand palette lives in **`src/theme/colors.ts`**. Two ways to consume:

- **Inside JSX/styles**: use the Tailwind utilities defined in `tailwind.config.js` (`bg-cream`, `text-ink`, `bg-green`, `border-line`, etc.).
- **In code (RN APIs that need a string)**: `import { T } from '@/theme'` and reference `T.green`, `T.ink`, `T.card`, etc.

Do **NOT** add raw `#XXXXXX` hex literals to feature files. They drift. Only `colors.ts` and `tailwind.config.js` should ever contain hex values.

| Token | Hex | Use |
|---|---|---|
| `green` | `#0F3F2E` | Primary CTA, brand anchor |
| `green-dark` | `#174F3C` | Hover / pressed |
| `green-soft` | `#DFE8D2` | Empty states, badges, soft accent |
| `cream` | `#FBF7EF` | Page background |
| `cream-warm` | `#EFE3D0` | Inactive interactive (pills, toggles) |
| `card` | `#FFFCF6` | Elevated cards (paired with shadow + border) |
| `line` | `#D9CCB6` | Hairline borders |
| `ink` | `#163026` | Primary text |
| `muted` | `#5F685F` | Secondary text |
| `gold` | `#F3C96A` | Premium / highlight accent |

**Coral is retired.** Legacy `bg-coral-*` classes still compile but the spec calls for **70% cream / 25% green / 5% gold accents**. If you find coral, replace it.

## Components

| Element | Component | Use |
|---|---|---|
| Filled CTA / cancel / link / delete | **`<Button>`** | Every interactive button. Variants: `primary` (green), `secondary` (cream-warm), `ghost` (text-only green), `destructive` (warm-rust). |
| Tag / chip / toggle | **`<Pill>`** | Status tag (no `onPress`) or toggleable filter (`onPress` + `selected`). 5 variants. |
| Single-line text input | **`<Input>`** | Optional `label`, `error`, `hint`. Brand surface + shadow + green focus. |
| Multi-line textarea | **`<Input multiline>`** | Same component, taller. |
| Form field with section label | **`<FormField label="..." required>`** wrapping `<Input>` | Repeating form sections. Adds the uppercase label automatically. |
| Bottom sheet modal | **`<Sheet>`** + **`<Sheet.Actions>`** | All "Add expense / Add block / Mark booked" sheets. Drag handle, backdrop, keyboard avoidance built in. |
| Card surface | **`<Card>`** / **`<PressableCard>`** | Elevated content surface. Hairline border + warm drop shadow auto. |
| Status badge | **`<Badge>`** | Pill with semantic variant (`success`/`warning`/`muted`/`default`). |
| Profile image / initial | **`<Avatar>`** | `imageUri` or `name` (initial fallback with deterministic brand-coherent tint). |
| Section label | **`<SectionHeader>`** | Uppercase / tracked label introducing a section. `required` adds `*`. |
| Branded loading | **`<Spinner>`** | Replaces inline `<ActivityIndicator color="#0F3F2E">`. Tones: `brand` / `muted` / `onPrimary`. |
| Switch toggle | **`<Toggle>`** | Brand-themed RN Switch. Replaces inline `trackColor` plumbing. |
| Empty state | **`<EmptyState>`** | Icon + title + body + optional action. Centered, branded. |
| Hairline divider | **`<Divider>`** | Single-pixel line in brand `line` color. |
| Celebration burst | **`<CelebrationBurst>`** | Confetti animation for milestones. |
| Place autocomplete | **`<PlacesAutocompleteInput>`** | Live Google Places suggestions in a brand-styled input. |

## Higher-level components

| Where | Component | Use |
|---|---|---|
| `src/components/DateRangePicker.tsx` | `<DateRangePicker>` | The single date / date-range picker. Used by trip-create, polls/dates, itinerary. |
| `src/components/landing/EmailCapture.tsx` | `<EmailCapture>` | The single beta-waitlist form. Used by `/`, `/t/[id]`, `/respond/[id]` post-submit. |
| `src/components/landing/LandingPage.tsx` | `<LandingPage>` | The marketing landing — also the destination of `/t/[tripId]` (trip-context variant) and `/download` (301). |

## Conventions

1. **No raw hex literals** in feature files. Use `T.*` or Tailwind classes.
2. **No inline `<Pressable>` for buttons.** Use `<Button>`. The only exception is icon-only taps (like the trash icon) — flag with `// FUTURE: icon-only Button variant`.
3. **No raw `<TextInput>` for forms.** Use `<Input>`.
4. **No raw `<Modal>` + Pressable backdrop for bottom sheets.** Use `<Sheet>`.
5. **Headlines use Georgia** — `fontFamily: Platform.OS === 'android' ? 'serif' : 'Georgia'`. Body uses Inter.
6. **Cards lift via shadow + border**, not just bg color. Use `<Card>` rather than `bg-card` directly when you want an elevated surface.
7. **Disabled primary CTAs use sage** (`#A0C0B2`) not gray. The Button component handles this automatically when you pass `disabled`.

## Adding a new component

If you need an element not in this list, add it here as its own file, export from `index.ts`, and update this README. The pattern is: a small focused component that closes over the brand decisions (colors, spacing, motion) so callers don't have to think about them.
