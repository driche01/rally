"use client";

/**
 * Fun on-theme loading graphic — a row of travel emojis bouncing in
 * a wave. CSS-only animation, no external assets.
 *
 * 🧳 ✈️ 🌴 🍹 🗺️
 *
 * Each emoji bounces with a staggered delay to create a left-to-
 * right wave that loops indefinitely. The container is small and
 * unobtrusive — meant to live inside the generation toast.
 */

const EMOJIS = ["🧳", "✈️", "🌴", "🍹", "🗺️"];

export default function TravelLoadingDance() {
  return (
    <div className="flex items-end gap-0.5 text-lg leading-none" aria-hidden>
      {EMOJIS.map((e, i) => (
        <span
          key={i}
          className="inline-block"
          style={{
            // Longhand props to avoid the React warning about mixing
            // `animation` shorthand with `animationDelay`.
            animationName:           "travel-bounce",
            animationDuration:       "1.4s",
            animationTimingFunction: "ease-in-out",
            animationIterationCount: "infinite",
            animationDelay:          `${i * 140}ms`,
          }}
        >
          {e}
        </span>
      ))}
      <style>{`
        @keyframes travel-bounce {
          0%, 80%, 100% { transform: translateY(0); }
          40%           { transform: translateY(-8px); }
        }
        @keyframes slide-in-right {
          from { transform: translateX(120%); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
        .animate-slide-in-right { animation: slide-in-right 320ms cubic-bezier(0.2,0.9,0.3,1.3); }
      `}</style>
    </div>
  );
}
