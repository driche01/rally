# Rally brand — web

The web brand is downstream of the mobile app's brand spec. Mobile
is the source of truth; web mirrors it so users see one Rally across
SMS-linked landings, the web app, and (eventually) the mobile app.

If you're tempted to add a hex, change a token, or introduce a new
accent — read this first, then read `src/theme/colors.ts` for the
canonical rationale.

## Where brand lives on web

| File | Role |
|---|---|
| `web/app/globals.css` | Tokens — single source of truth for the CSS layer (`@theme` block). Tailwind utilities (`bg-cream`, `text-green`, etc.) compile from here. |
| `web/lib/brand/logo.tsx` | The `RallyLogo` wordmark — "● RALLY" green dot + Georgia. Matches mobile's `BrandMark`. |
| `web/lib/brand/app-header.tsx` | App-wide header that mounts the logo. |
| `web/lib/themes.ts` | Per-trip theme catalog (18 variants). Layered ON TOP of the core brand; per-trip flavor, not core identity. |

The mobile source files this mirrors:
- `src/theme/colors.ts` — palette + voice rules
- `src/theme/index.ts` — typography, spacing, radii, shadows
- `src/components/ui/BrandMark.tsx` — the "● RALLY" wordmark
- `tailwind.config.js` — NativeWind utilities

## Voice — non-negotiables

These rules come from `src/theme/colors.ts`. They apply to every
new screen.

- **Green is primary.** CTAs, anchors, headlines, key UI. `bg-green`,
  `text-green`.
- **Cream is the signature background — never pure white.** Use
  `bg-cream`. Pure white reads clinical against the rest of the app.
- **Ink is primary text — never pure black.** Use `text-ink`. Pure
  black is too harsh on cream.
- **Gold is the one allowed warm accent.** Use sparingly for premium
  signals, highlights, badges. Not for CTAs.
- **Destructive actions use warm-rust (`text-destructive` / `bg-destructive`).**
  Not pure red. Not coral.
- **No coral. No blue. No cool tones.**
- **Approximate ratio: 70% cream / 25% green / 5% gold accents.**
  If a screen reads "too green" or "too gold," step back and
  re-balance.

## Semantic colors

| Token | Use |
|---|---|
| `text-success` / `bg-success` | Confirmation, success states. Green family (`#1D9E75`). |
| `text-warning` / `bg-warning` | Soft warnings, attention without alarm. Maps to gold. |
| `text-error` / `bg-error` | Error messages, validation failures. Deep warm red (`#C13515`). |
| `text-destructive` / `bg-destructive` | Delete/cancel buttons. Warm-rust (`#9A3F23`). |

**Migration note (2026-05-16):** Pre-existing screens still use
`text-orange` for error/destructive/warning states. The
`--color-orange` token is kept alive as a compile-shim only — do
NOT use it in new code. Map per the table above when you touch a
file.

## Surfaces

Layered, ~5–8% luminance step between adjacent layers so each
surface is perceivable at a glance.

| Token | Use |
|---|---|
| `bg-cream` (`#FBF7EF`) | Page background — lightest. |
| `bg-cream-2` (`#F4ECDF`) | Secondary cream surface, recessed areas. |
| `bg-cream-warm` (`#EFE3D0`) | Inactive interactive surfaces — pills, toggles, unselected calendar days. |
| `bg-card` (`#FFFCF6`) | Elevated cards — near-white with a whisper of warmth. |
| `border-line` (`#D9CCB6`) | Hairline borders — visible-but-quiet on cream. |

## Typography

- **Display:** Georgia (system serif on every target platform). Used
  for headlines, the wordmark, editorial moments. `font-display`.
- **Body:** Inter. `font-body`.
- **Never** mix in a third typeface for "decoration." If a screen
  needs more visual weight, lean on weight/size, not face.

## The wordmark

```tsx
import RallyLogo from "@/lib/brand/logo";

<RallyLogo />                          // md, links to /
<RallyLogo size="sm" />                // tight headers
<RallyLogo size="lg" />                // hero placement
<RallyLogo variant="cream" />          // on photo/dark backgrounds
<RallyLogo asLink={false} />           // passive brand mark
```

The mark is always green dot + uppercase "RALLY" in Georgia. Never
render the brand as plain `<span>Rally</span>` or any title-case /
lowercase variant — use this component.

## Shadows

Warm-tinted (`rgba(58, 45, 20, …)`) so they blend with the cream
surface. Cool/neutral shadows on a warm palette read as "off."
Three tiers: `shadow-sm`, `shadow-md`, `shadow-lg`.

## Adding a new token

1. Add it to `globals.css` inside the `@theme` block.
2. If the mobile app needs it too: open a flag and align before
   shipping — don't let the platforms drift.
3. Document the use case in this file.

## What about per-trip themes?

`web/lib/themes.ts` lives on top of the brand. Per-trip themes
(`vibes`, `light`, `dark`, `seasonal`) are planner-picked flavors —
they're allowed to introduce per-theme accent hexes that aren't in
the core token set. Constraints:

- Every theme MUST keep a brand-coherent surface tone (cream-leaning
  for light themes; deep + saturated for dark themes).
- No coral. No new corporate-blue. Warmth + green-family +
  gold-family + selective seasonal accents only.
