"use client";

/**
 * VariableLegend — small chips listing the placeholders a planner
 * can drop into an SMS body. Shown directly below the textarea in
 * both the invite modal and the blast composer so the available
 * tokens are visible while typing.
 *
 * The token list comes from PERSONALIZE_TOKENS in `@/lib/personalize`
 * so the UI and the substitution helper can never drift.
 *
 * Click a chip to insert the token at the caller's textarea cursor
 * — pass the textarea ref via `onInsert` to wire it up.
 */

import { PERSONALIZE_TOKENS } from "@/lib/personalize";

interface Props {
  /** Optional callback for clicking a token chip — receives the
   *  literal token string ("[Name]"). When provided, chips become
   *  interactive buttons; otherwise they're read-only labels. */
  onInsert?: (token: string) => void;
  className?: string;
}

export default function VariableLegend({ onInsert, className = "" }: Props) {
  return (
    <div className={`grid gap-1.5 ${className}`}>
      <p className="text-[11px] uppercase tracking-widest text-muted font-semibold">
        Available variables
      </p>
      <div className="flex flex-wrap gap-1.5">
        {PERSONALIZE_TOKENS.map((t) => {
          const inner = (
            <>
              <code className="font-mono text-[11px]">{t.token}</code>
              <span className="text-[10px] text-muted">{t.description}</span>
            </>
          );
          if (onInsert) {
            return (
              <button
                key={t.token}
                type="button"
                onClick={() => onInsert(t.token)}
                title={`Insert ${t.token}`}
                className="inline-flex items-center gap-1.5 h-7 px-2 rounded-full bg-card border border-line text-ink hover:border-green hover:bg-green-soft/30 transition-colors"
              >
                {inner}
              </button>
            );
          }
          return (
            <span
              key={t.token}
              className="inline-flex items-center gap-1.5 h-7 px-2 rounded-full bg-card border border-line text-ink"
            >
              {inner}
            </span>
          );
        })}
      </div>
    </div>
  );
}
