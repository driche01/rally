/**
 * Inline SVG icon sprite for the RSVP profile-capture flow.
 * Ported from /web/prototype/profile-capture/index.html.
 * One source of truth — option buttons reference symbols via <use href>.
 */

export function IconSprite() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="0"
      height="0"
      style={{ position: "absolute", overflow: "hidden" }}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <symbol id="i-sun" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </symbol>
        <symbol id="i-mountain" viewBox="0 0 24 24">
          <path d="m8 3 4 8 5-5 5 15H2L8 3z" />
        </symbol>
        <symbol id="i-half" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 3v18" />
          <path d="M12 3a9 9 0 0 1 0 18Z" fill="currentColor" stroke="none" />
        </symbol>
        <symbol id="i-leaf" viewBox="0 0 24 24">
          <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z" />
          <path d="M2 21c0-3 1.85-5.36 5.08-6" />
        </symbol>
        <symbol id="i-footprints" viewBox="0 0 24 24">
          <path d="M4 16v-2.38c0-.954-.083-1.882.236-2.783C4.8 9.04 6.7 7 9 7c1.387 0 2.5.5 2.5 2.5 0 .87-.41 1.667-.94 2.41A11 11 0 0 0 8.5 18.5l-.41 2.55A1.5 1.5 0 0 1 6.59 22h-1.59A1.5 1.5 0 0 1 3.5 20.5L4 16Z" />
          <path d="M20 16v-2.38c0-.954.083-1.882-.236-2.783C19.2 9.04 17.3 7 15 7c-1.387 0-2.5.5-2.5 2.5 0 .87.41 1.667.94 2.41A11 11 0 0 1 15.5 18.5l.41 2.55A1.5 1.5 0 0 0 17.41 22H19a1.5 1.5 0 0 0 1.5-1.5L20 16Z" />
        </symbol>
        <symbol id="i-shuffle" viewBox="0 0 24 24">
          <path d="M16 3h5v5" />
          <path d="M4 20 21 3" />
          <path d="m21 16 3-3-3-3" />
          <path d="M4 4l5 5" />
          <path d="m15 15 6 6" />
        </symbol>
        <symbol id="i-wine" viewBox="0 0 24 24">
          <path d="M8 22h8" />
          <path d="M12 17v5" />
          <path d="M7 2h10v5a5 5 0 0 1-10 0V2Z" />
          <path d="M7 7h10" />
        </symbol>
        <symbol id="i-utensils" viewBox="0 0 24 24">
          <path d="M3 2v7c0 1.1.9 2 2 2h2v11" />
          <path d="M7 2v20" />
          <path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7" />
        </symbol>
        <symbol id="i-sparkles" viewBox="0 0 24 24">
          <path d="M12 3v3" />
          <path d="M12 18v3" />
          <path d="M4 12H1" />
          <path d="M23 12h-3" />
          <path d="m4.93 4.93 2.12 2.12" />
          <path d="m16.95 16.95 2.12 2.12" />
          <path d="m4.93 19.07 2.12-2.12" />
          <path d="m16.95 7.05 2.12-2.12" />
          <circle cx="12" cy="12" r="3" />
        </symbol>
        <symbol id="i-moon" viewBox="0 0 24 24">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
        </symbol>
        <symbol id="i-swap" viewBox="0 0 24 24">
          <path d="m16 3 4 4-4 4" />
          <path d="M20 7H4" />
          <path d="m8 21-4-4 4-4" />
          <path d="M4 17h16" />
        </symbol>
        <symbol id="i-landmark" viewBox="0 0 24 24">
          <line x1="3" y1="22" x2="21" y2="22" />
          <line x1="6" y1="18" x2="6" y2="11" />
          <line x1="10" y1="18" x2="10" y2="11" />
          <line x1="14" y1="18" x2="14" y2="11" />
          <line x1="18" y1="18" x2="18" y2="11" />
          <polygon points="12 2 20 7 4 7" />
        </symbol>
        <symbol id="i-waves" viewBox="0 0 24 24">
          <path d="M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" />
          <path d="M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" />
          <path d="M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" />
        </symbol>
        <symbol id="i-scale" viewBox="0 0 24 24">
          <path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z" />
          <path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z" />
          <path d="M7 21h10" />
          <path d="M12 3v18" />
          <path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2" />
        </symbol>
        <symbol id="i-check" viewBox="0 0 24 24">
          <path d="M20 6 9 17l-5-5" />
        </symbol>
      </defs>
    </svg>
  );
}

export function Icon({
  id,
  className = "w-7 h-7",
}: {
  id: string;
  className?: string;
}) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <use href={`#${id}`} />
    </svg>
  );
}
