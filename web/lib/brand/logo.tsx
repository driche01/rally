/**
 * Rally wordmark — canonical "● RALLY" mark.
 *
 * Green filled dot + uppercase Georgia "RALLY" with letterspacing.
 * Identical spec to the mobile app's BrandMark
 * (src/components/ui/BrandMark.tsx) — the two platforms render the
 * same identifier pixel-for-pixel so users see one Rally, not two.
 *
 *   font-family: Georgia, "Times New Roman", serif
 *   font-weight: 700
 *   text-transform: uppercase
 *   letter-spacing: 1px
 *   color: --color-green
 *
 * Georgia is system-installed on every target platform (macOS, iOS,
 * Windows, Android, ChromeOS) so the wordmark renders consistent
 * without bundling a webfont.
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
 * Sizes (dot diameter / fontSize / gap, in px — mirrors mobile):
 *   sm  →  8 / 16 / 5
 *   md  → 10 / 20 / 6   (default)
 *   lg  → 14 / 28 / 8
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

const SIZE_MAP: Record<RallyLogoSize, { dot: number; font: number; gap: number }> = {
  sm: { dot: 8,  font: 16, gap: 5 },
  md: { dot: 10, font: 20, gap: 6 },
  lg: { dot: 14, font: 28, gap: 8 },
};

export default function RallyLogo({
  size = "md",
  variant = "green",
  asLink = true,
  className = "",
}: LogoProps) {
  const { dot, font, gap } = SIZE_MAP[size];
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
          fontFamily: 'Georgia, "Times New Roman", serif',
          fontWeight: 700,
          textTransform: "uppercase",
          fontSize: font,
          letterSpacing: "1px",
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
