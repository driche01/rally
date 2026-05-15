"use client";

/**
 * Effect overlay — renders an animated decorative layer over the
 * trip page when `trips.effect` is set. All effects are CSS-only
 * (no canvas, no JS animation loops) so they run cheaply, work on
 * SSR, and never block interaction. The overlay is `pointer-events-
 * none` so clicks pass through to the content beneath.
 *
 * Each effect uses a small swarm of particles (8-24) rendered as
 * absolutely-positioned spans/svgs, each with a distinct animation
 * delay + duration to look organic.
 *
 * Effects:
 *   sparkles    — twinkling pinpoint stars
 *   confetti    — drifting square confetti
 *   hearts      — rising heart emoji
 *   snowflakes  — falling snowflakes
 *   bubbles     — rising soap bubbles
 *   petals      — drifting cherry-blossom petals
 *   embers      — rising glowing dots
 *   stars       — slow drifting star pattern
 */

import type { TripEffect } from "@shared/types";

const N_PARTICLES = 18;

export default function EffectOverlay({ effect }: { effect: TripEffect | null | undefined }) {
  if (!effect) return null;

  const variants: Record<TripEffect, EffectVariant> = {
    sparkles:   { char: "✦",  size: "0.9rem", color: "#F3C96A", anim: "rally-drift",    extraClass: "" },
    confetti:   { char: "■",  size: "0.7rem", color: "#FF6A45", anim: "rally-fall",     extraClass: "rally-confetti-spin" },
    hearts:     { char: "❤",  size: "1rem",   color: "#FF459F", anim: "rally-rise",     extraClass: "" },
    snowflakes: { char: "❄",  size: "1rem",   color: "#E8EEF5", anim: "rally-fall",     extraClass: "" },
    bubbles:    { char: "○",  size: "1.1rem", color: "#9FE8FF", anim: "rally-rise",     extraClass: "" },
    petals:     { char: "✿",  size: "1rem",   color: "#FFD5E5", anim: "rally-drift",    extraClass: "" },
    embers:     { char: "•",  size: "0.6rem", color: "#FF8C4B", anim: "rally-ember",    extraClass: "" },
    stars:      { char: "★",  size: "0.7rem", color: "#F3C96A", anim: "rally-twinkle",  extraClass: "" },
  };
  const v = variants[effect];

  // Stable random-looking values seeded by the index — keeps SSR/
  // hydration consistent without importing a seeded-RNG library.
  const particles = Array.from({ length: N_PARTICLES }, (_, i) => {
    const leftPct  = (i * 137) % 100;
    const delay    = (i * 0.43) % (effect === "embers" ? 4 : 8);
    const duration = (effect === "embers" ? 3 : 8) + ((i * 0.71) % 6);
    const opacity  = 0.5 + ((i * 0.11) % 0.5);
    const size     = parseFloat(v.size) * (0.6 + ((i * 0.13) % 0.8));
    return { leftPct, delay, duration, opacity, size, i };
  });

  return (
    <div
      aria-hidden
      className="fixed inset-0 pointer-events-none z-30 overflow-hidden"
    >
      {particles.map((p) => (
        <span
          key={p.i}
          className={"absolute select-none " + v.extraClass}
          style={{
            left:            `${p.leftPct}%`,
            top:             `-10%`,
            fontSize:        `${p.size}rem`,
            color:           v.color,
            opacity:         p.opacity,
            animation:       `${v.anim} ${p.duration}s linear infinite`,
            animationDelay:  `${p.delay}s`,
            textShadow:      effect === "sparkles" || effect === "stars" || effect === "embers"
              ? `0 0 8px ${v.color}`
              : undefined,
          }}
        >
          {v.char}
        </span>
      ))}
      <style>{`
        @keyframes rally-fall {
          0%   { transform: translate3d(0,  -10vh, 0) rotate(0deg); }
          100% { transform: translate3d(0, 110vh, 0) rotate(360deg); }
        }
        @keyframes rally-rise {
          0%   { transform: translate3d(0,  110vh, 0) scale(0.8); opacity: 0; }
          15%  { opacity: 1; }
          100% { transform: translate3d(0,  -10vh, 0) scale(1.2); opacity: 0; }
        }
        @keyframes rally-drift {
          0%   { transform: translate3d(0,  -10vh, 0); }
          100% { transform: translate3d(8vw, 110vh, 0); }
        }
        @keyframes rally-ember {
          0%   { transform: translate3d(0,  100vh, 0) scale(0.6); opacity: 0; }
          10%  { opacity: 1; }
          100% { transform: translate3d(-4vw, -10vh, 0) scale(1.2); opacity: 0; }
        }
        @keyframes rally-twinkle {
          0%, 100% { opacity: 0.2; transform: scale(0.7); }
          50%      { opacity: 1;   transform: scale(1.2); }
        }
        .rally-confetti-spin { display: inline-block; }
      `}</style>
    </div>
  );
}

interface EffectVariant {
  char: string;
  size: string;
  color: string;
  anim: string;
  extraClass: string;
}

/** Category label for the effect picker. */
export const EFFECT_CATALOG: {
  value: TripEffect;
  label: string;
  emoji: string;
  category: "fun" | "classic" | "seasonal";
}[] = [
  { value: "sparkles",   label: "Sparkles",   emoji: "✨", category: "fun"      },
  { value: "confetti",   label: "Confetti",   emoji: "🎉", category: "fun"      },
  { value: "hearts",     label: "Hearts",     emoji: "❤️", category: "fun"      },
  { value: "bubbles",    label: "Bubbles",    emoji: "🫧", category: "fun"      },
  { value: "stars",      label: "Starfield",  emoji: "⭐", category: "classic"  },
  { value: "embers",     label: "Embers",     emoji: "🔥", category: "classic"  },
  { value: "petals",     label: "Petals",     emoji: "🌸", category: "seasonal" },
  { value: "snowflakes", label: "Snowfall",   emoji: "❄️", category: "seasonal" },
];
