/**
 * Rally wordmark — canonical "● RALLY" mark.
 *
 * Green filled dot + uppercase Fredoka "RALLY" with letterspacing.
 *
 *   font-family: var(--font-display)  →  Fredoka (Google Fonts)
 *   font-weight: 700
 *   text-transform: uppercase
 *   letter-spacing: 1px
 *   color: --color-green
 *
 * Fredoka is loaded via @import in globals.css. Falls back to Inter →
 * system sans while the webfont is fetching. The mobile app's
 * BrandMark renders Georgia; once we add Fredoka there too, the two
 * platforms will be identical again.
 *
 * NEVER render the wordmark as a raw <span>Rally</span> or
 * <span>rally</span>. Lower/title case forms are off-brand and
 * drift between screens is exactly what this component prevents.
 *
 * Variants:
 *   <RallyLogo />              md size, links to "/"
 *   <RallyLogo size="sm">      tight headers, navigation bars
 *   <RallyLogo size="lg">      full-screen entry points / hero
 *   <RallyLogo variant="cream"> for photo/dark backgrounds
 *   <RallyLogo asLink={false}> passive brand mark, no link
 *
 * Sizes (dot diameter / fontSize / gap / tracking, in px):
 *   sm  →  8 / 16 / 5 / 0.5
 *   md  → 10 / 20 / 6 / 0.5  (default)
 *   lg  → 14 / 28 / 8 / 1
 *
 * Tracking is tuned for Fredoka's wider/rounder letterforms — Georgia
 * needed 1px across the board, Fredoka reads tighter so sm/md drop
 * to 0.5px and only lg keeps the full 1px for hero presence.
 */

import Link from "next/link";

export type RallyLogoSize = "sm" | "md" | "lg";
export type RallyLogoVariant = "green" | "cream";

interface LogoProps {
  size?: RallyLogoSize;
  variant?: RallyLogoVariant;
  /** Render as a Link to "/" (default true) or plain span (false). */
  asLink?: boolean;
  /** Extra classes on the outer container. */
  className?: string;
}

const SIZE_MAP: Record<RallyLogoSize, { dot: number; font: number; gap: number; tracking: number }> = {
  sm: { dot: 8,  font: 16, gap: 5, tracking: 0.5 },
  md: { dot: 10, font: 20, gap: 6, tracking: 0.5 },
  lg: { dot: 14, font: 28, gap: 8, tracking: 1 },
};

export default function RallyLogo({
  size = "md",
  variant = "green",
  asLink = true,
  className = "",
}: LogoProps) {
  const { dot, font, gap, tracking } = SIZE_MAP[size];
  const color =
    variant === "cream" ? "var(--color-cream)" : "var(--color-green)";

  const mark = (
    <span
      className={`inline-flex items-center ${className}`}
      style={{ gap }}
      aria-label="Rally"
    >
      <span
        aria-hidden="true"
        style={{
          width: dot,
          height: dot,
          borderRadius: "9999px",
          backgroundColor: color,
          display: "inline-block",
          flexShrink: 0,
        }}
      />
      <span
        style={{
          fontFamily: "var(--font-display)",
          fontWeight: 700,
          textTransform: "uppercase",
          fontSize: font,
          letterSpacing: `${tracking}px`,
          lineHeight: 1,
          color,
        }}
      >
        RALLY
      </span>
    </span>
  );

  if (!asLink) return mark;
  return (
    <Link
      href="/"
      aria-label="Rally — home"
      className="inline-flex items-center hover:opacity-80 transition-opacity"
    >
      {mark}
    </Link>
  );
}
