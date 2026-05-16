/**
 * Rally wordmark — heavy italic Georgia serif, dark green, no
 * separate mark. Matches the wordmark spec already shipped on the
 * marketing landing page (`/rally_landingpage_v1.html`):
 *
 *   font-family: Georgia, "Times New Roman", serif
 *   font-weight: 700
 *   font-style:  italic
 *   letter-spacing: -0.045em
 *   color: --color-green
 *
 * Georgia is system-installed across every target platform (macOS,
 * iOS, Windows, Android, ChromeOS) so the wordmark renders pixel-
 * consistent without bundling a webfont.
 *
 * Variants:
 *   <RallyLogo />          full wordmark at md size, links to "/"
 *   <RallyLogo size="sm">  smaller for dense surfaces
 *   <RallyLogo size="lg">  hero placement
 *   <RallyLogo asLink={false}>  passive brand mark (no link)
 *   <RallyMark />          legacy concentric-circles mark, kept for
 *                          favicon / cramped surfaces only
 */

import Link from "next/link";

interface LogoProps {
  /** Tailwind text-* size; default is text-2xl. */
  size?: "sm" | "md" | "lg";
  /** Render as a Link to "/" (default true) or plain span (false). */
  asLink?: boolean;
  /** Override the className of the outer container. */
  className?: string;
  /** Override the color class. Defaults to text-green. */
  colorClass?: string;
}

const SIZES = {
  sm: "text-xl",   // 20px
  md: "text-2xl",  // 24px
  lg: "text-4xl",  // 36px
} as const;

export default function RallyLogo({
  size = "md",
  asLink = true,
  className = "",
  colorClass = "text-green",
}: LogoProps) {
  const wordmark = (
    <span
      // Inline style locks the type spec — Tailwind's tracking
      // utilities don't expose -0.045em precisely, and the italic
      // bold combo is load-bearing for brand recognition.
      style={{
        fontFamily:    'Georgia, "Times New Roman", serif',
        fontWeight:    700,
        fontStyle:     "italic",
        letterSpacing: "-0.045em",
        lineHeight:    1,
      }}
      className={`${SIZES[size]} ${colorClass} ${className}`}
    >
      Rally
    </span>
  );

  if (!asLink) return wordmark;
  return (
    <Link
      href="/"
      aria-label="Rally — home"
      className="inline-flex items-center hover:opacity-80 transition-opacity"
    >
      {wordmark}
    </Link>
  );
}

/**
 * Concentric-circles "target" mark. Kept around for the favicon and
 * any cramped surface that can't carry the full wordmark. NOT used
 * in the standard header anymore — the wordmark replaces it.
 */
export function RallyMark({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      style={{ display: "block" }}
    >
      <circle cx="12" cy="12" r="10.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <circle cx="12" cy="12" r="6"    stroke="currentColor" strokeWidth="1.5" fill="none" />
      <circle cx="12" cy="12" r="2.2"  fill="currentColor" />
    </svg>
  );
}
