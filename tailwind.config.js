/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,ts,jsx,tsx}', './src/**/*.{js,ts,jsx,tsx}'],
  presets: [require('nativewind/preset')],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // ─── Brand (2026-04-24) ──────────────────────────────────────────
        // Primary anchor. Use for CTAs, headlines, key UI.
        green: {
          DEFAULT: '#0F3F2E',
          dark:    '#174F3C',
          soft:    '#DFE8D2',
        },
        // Cream backgrounds — Rally's signature surface.
        // ~5-8% luminance gap between adjacent layers so each surface is
        // perceivable at a glance. See src/theme/colors.ts for rationale.
        cream: {
          DEFAULT: '#FBF7EF',  // page bg
          warm:    '#EFE3D0',  // inactive interactive surface (pills, toggles)
        },
        card: '#FFFAF2',       // elevated card (paired with shadow + border)
        line: '#D9CCB6',       // hairline border (visible-but-quiet)
        // Text colors — never pure black.
        ink:   '#163026',
        muted: '#5F685F',
        // Premium accent.
        gold:  '#F3C96A',

        // ─── Demoted accent — sparing use only ──────────────────────────
        // Kept for legacy surfaces. Do NOT use as a primary CTA color.
        coral: {
          50:  '#FEF3EE',
          100: '#FCE3D1',
          200: '#F9C4A5',
          300: '#F49D70',
          400: '#ED7040',
          500: '#D85A30',
          600: '#BE4820',
          700: '#9A3918',
          800: '#782B12',
          900: '#551E0C',
        },

        // ─── Legacy neutrals ─────────────────────────────────────────────
        // Prefer cream/card/line/ink/muted for new code.
        neutral: {
          50:  '#FAFAFA',
          100: '#F5F5F5',
          200: '#E8E8E8',
          300: '#D1D1D1',
          400: '#A8A8A8',
          500: '#717171',
          600: '#4A4A4A',
          700: '#3A3A3A',
          800: '#222222',
          900: '#111111',
        },
      },
      fontFamily: {
        sans:     ['Inter_400Regular'],
        medium:   ['Inter_500Medium'],
        semibold: ['Inter_600SemiBold'],
        bold:     ['Inter_700Bold'],
        // Editorial display — system Georgia (iOS/macOS/web), serif fallback (Android).
        headline: ['Georgia', 'serif'],
      },
      borderRadius: {
        // Aligned with brand spec.
        sm:    '8px',
        md:    '12px',
        lg:    '18px',
        xl:    '28px',
        '2xl': '16px',  // legacy
        '3xl': '24px',  // legacy
      },
    },
  },
  plugins: [],
};
