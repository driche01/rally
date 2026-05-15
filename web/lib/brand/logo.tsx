/**
 * Rally logo — wordmark + a small "rally point" mark.
 *
 * Pure SVG mark + display-serif text. No image assets — the logo
 * scales cleanly at any size and picks up theme tokens via
 * `currentColor`. Used in every page header for brand consistency.
 *
 * The mark is a stylized target: concentric circles around a center
 * dot. Reads as a meeting point / rendezvous, which is what Rally is.
 *
 * Variants:
 *   <RallyLogo />          full wordmark + mark, default sizing
 *   <RallyLogo size="sm">  smaller for dense surfaces
 *   <RallyLogo size="lg">  hero placement
 *   <RallyMark />          just the SVG mark (no text)
 */

import Link from "next/link";

interface LogoProps {
  /** Tailwind text-* size; default is text-xl. */
  size?: "sm" | "md" | "lg";
  /** Render as a Link to "/" (default true) or plain span (false). */
  asLink?: boolean;
  /** Override the className of the outer container. */
  className?: string;
  /** Override the color class. Defaults to text-green (uses currentColor on the mark). */
  colorClass?: string;
}

const SIZES = {
  sm: { text: "text-base",  mark: 14 },
  md: { text: "text-xl",    mark: 18 },
  lg: { text: "text-3xl",   mark: 26 },
} as const;

export default function RallyLogo({
  size = "md",
  asLink = true,
  className = "",
  colorClass = "text-green",
}: LogoProps) {
  const { text, mark } = SIZES[size];

  const inner = (
    <span className={`inline-flex items-center gap-1.5 ${colorClass} ${className}`}>
      <RallyMark size={mark} />
      <span className={`font-display ${text} font-normal tracking-tight leading-none`}>
        rally
      </span>
    </span>
  );

  if (!asLink) return inner;
  return (
    <Link
      href="/"
      aria-label="Rally — home"
      className="inline-flex items-center hover:opacity-80 transition-opacity"
    >
      {inner}
    </Link>
  );
}

/**
 * Just the mark, no wordmark. Useful as a favicon-style accent on
 * cramped surfaces.
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
      {/* Outer ring */}
      <circle cx="12" cy="12" r="10.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
      {/* Inner ring */}
      <circle cx="12" cy="12" r="6"    stroke="currentColor" strokeWidth="1.5" fill="none" />
      {/* Center dot */}
      <circle cx="12" cy="12" r="2.2"  fill="currentColor" />
    </svg>
  );
}
