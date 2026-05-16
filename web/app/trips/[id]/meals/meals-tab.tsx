"use client";

/**
 * Meals tab — AI meal plan with dietary surfacing + voting + cook
 * assignment. Phase B Step 7.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { themeClass } from "@/lib/themes";
import { useGeneration } from "@/lib/generation/provider";
import type { Trip } from "@shared/types";

export interface GoingMember { id: string; name: string; }

export interface MealView {
  id: string;
  day_date: string;
  meal_type: "breakfast" | "lunch" | "dinner" | "snack";
  mode: "cook_in" | "restaurant" | "tbd";
  recipe_name: string | null;
  restaurant_name: string | null;
  restaurant_url: string | null;
  notes: string | null;
  assigned_cook_respondent_ids: string[];
  ai_suggested: boolean;
  ingredients: { name: string; quantity: number; unit: string; category: string }[];
  tallies: { yes: number; no: number; maybe: number };
  myVote: "yes" | "no" | "maybe" | null;
}

const MEAL_TYPE_ORDER = ["breakfast", "lunch", "dinner", "snack"] as const;
const MEAL_TYPE_LABEL = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner", snack: "Snack" };

export default function MealsTab({
  tripId, tripTheme, startDate, endDate,
  canManage, callerRespondentId, goingMembers,
  meals: initialMeals,
}: {
  tripId: string;
  tripTheme: Trip["theme"];
  startDate: string | null;
  endDate: string | null;
  canManage: boolean;
  callerRespondentId: string | null;
  goingMembers: GoingMember[];
  meals: MealView[];
}) {
  const router = useRouter();
  const [meals, setMeals] = useState<MealView[]>(initialMeals);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [, startTrans] = useTransition();

  const t = themeClass(tripTheme);
  const hasMeals = meals.length > 0;

  const generation = useGeneration();
  const generating = generation.isRunning("meals");

  function generate(regenerate: boolean) {
    setErr(null);
    setAiNote(null);
    generation.start({
      kind: "meals",
      label: regenerate ? "Regenerating meal plan…" : "Generating meal plan…",
      fetcher: () => fetch(`/api/trips/${tripId}/meals/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ regenerate }),
      }),
      onDone: (data) => {
        const note = (data as { data?: { note?: string } } | null)?.data?.note ?? null;
        setAiNote(note);
        startTrans(() => router.refresh());
      },
    });
  }

  async function vote(mealId: string, choice: "yes" | "no" | "maybe") {
    if (!callerRespondentId) {
      setErr("You don't have an RSVP on this trip yet.");
      return;
    }
    setErr(null);
    setMeals((prev) =>
      prev.map((m) => {
        if (m.id !== mealId) return m;
        const tallies = { ...m.tallies };
        if (m.myVote) tallies[m.myVote] = Math.max(0, tallies[m.myVote] - 1);
        const newVote = m.myVote === choice ? null : choice;
        if (newVote) tallies[newVote]++;
        return { ...m, tallies, myVote: newVote };
      }),
    );
    try {
      const res = await fetch(`/api/trips/${tripId}/meals/${mealId}/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vote: choice }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => null);
        setErr(b?.error?.code || `Vote failed (${res.status})`);
        startTrans(() => router.refresh());
      }
    } catch {
      setErr("Couldn't reach Rally. Try again.");
      startTrans(() => router.refresh());
    }
  }

  async function setCooks(mealId: string, ids: string[]) {
    setErr(null);
    try {
      const res = await fetch(`/api/trips/${tripId}/meals/${mealId}/cooks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cook_respondent_ids: ids }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => null);
        setErr(b?.error?.code || `Update failed (${res.status})`);
        return;
      }
      startTrans(() => router.refresh());
    } catch {
      setErr("Couldn't reach Rally. Try again.");
    }
  }

  const byDay = groupByDay(meals);

  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <h2 className={`text-2xl ${t.display}`}>Meals</h2>
        {canManage && (
          <div className="flex gap-2 flex-wrap">
            {hasMeals && (
              <button
                onClick={() => generate(true)}
                disabled={generating}
                className={`h-10 px-4 rounded-full ${t.surface} text-ink border ${t.surfaceBorder} hover:border-green text-sm disabled:opacity-50`}
              >
                {generating ? "Regenerating…" : "Regenerate"}
              </button>
            )}
            {!hasMeals && (
              <button
                onClick={() => generate(false)}
                disabled={generating || !startDate || !endDate}
                className="h-11 px-5 rounded-full bg-green text-cream font-bold hover:bg-green-2 text-sm disabled:opacity-50"
              >
                {generating ? "Generating…" : "Generate meal plan →"}
              </button>
            )}
          </div>
        )}
      </div>

      {err && <p className="text-orange text-sm mb-4">{err}</p>}
      {aiNote && <p className={`text-xs mb-4 italic ${t.meta}`}>{aiNote}</p>}

      {!hasMeals && (
        <div className={`${t.surface} border ${t.surfaceBorder} rounded-2xl p-8 text-center`}>
          <p className={`mb-2 ${t.body}`}>No meal plan yet.</p>
          {canManage ? (
            (!startDate || !endDate) ? (
              <p className={`text-sm ${t.meta}`}>Set trip start + end dates first.</p>
            ) : (
              <p className={`text-sm ${t.meta}`}>
                Tap &ldquo;Generate meal plan&rdquo;. Claude honors dietary restrictions across your group.
              </p>
            )
          ) : (
            <p className={`text-sm ${t.meta}`}>Once the host generates a plan, meals will appear here.</p>
          )}
        </div>
      )}

      <div className="grid gap-6">
        {byDay.map(({ day, items }) => (
          <section key={day}>
            <h3 className={`text-xs mb-3 ${t.eyebrow}`}>{formatDay(day)}</h3>
            <ul className="grid gap-3">
              {items.map((m) => (
                <li key={m.id}>
                  <MealCard
                    meal={m}
                    t={t}
                    canVote={!!callerRespondentId}
                    canManage={canManage}
                    goingMembers={goingMembers}
                    onVote={(c) => vote(m.id, c)}
                    onSetCooks={(ids) => setCooks(m.id, ids)}
                  />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

function MealCard({
  meal, t, canVote, canManage, goingMembers, onVote, onSetCooks,
}: {
  meal: MealView;
  t: ReturnType<typeof themeClass>;
  canVote: boolean;
  canManage: boolean;
  goingMembers: GoingMember[];
  onVote: (c: "yes" | "no" | "maybe") => void;
  onSetCooks: (ids: string[]) => void;
}) {
  const total = meal.tallies.yes + meal.tallies.no + meal.tallies.maybe;
  const [showCookPicker, setShowCookPicker] = useState(false);

  const cookNames = meal.assigned_cook_respondent_ids
    .map((id) => goingMembers.find((m) => m.id === id)?.name)
    .filter((n): n is string => !!n);

  return (
    <article className={`${t.surface} border ${t.surfaceBorder} rounded-2xl p-4`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <p className={`text-[10px] uppercase tracking-widest font-bold mb-1 ${t.meta}`}>
            {MEAL_TYPE_LABEL[meal.meal_type]} ·{" "}
            {meal.mode === "cook_in" ? "Cook in" : meal.mode === "restaurant" ? "Out" : "TBD"}
            {meal.ai_suggested ? " · AI draft" : ""}
          </p>
          <p className={`font-bold ${t.body}`}>
            {meal.mode === "cook_in" ? meal.recipe_name : meal.restaurant_name}
          </p>
          {meal.notes && <p className={`text-sm mt-1 ${t.body}`}>{meal.notes}</p>}
          {meal.restaurant_url && (
            <a
              href={meal.restaurant_url} target="_blank" rel="noopener"
              className={`text-xs underline ${t.eyebrow} mt-2 inline-block`}
            >
              Open ↗
            </a>
          )}
        </div>
        <div className="flex gap-1 flex-shrink-0" role="group" aria-label="Vote">
          {(["yes", "maybe", "no"] as const).map((c) => {
            const active = meal.myVote === c;
            const label = c === "yes" ? "👍" : c === "maybe" ? "🤷" : "👎";
            return (
              <button
                key={c}
                type="button"
                disabled={!canVote}
                onClick={() => onVote(c)}
                aria-label={`Vote ${c}`}
                aria-pressed={active}
                className={
                  "h-8 w-8 rounded-full inline-flex items-center justify-center text-base transition-colors " +
                  (active
                    ? "bg-green text-cream border border-green"
                    : `${t.surface} border ${t.surfaceBorder} hover:border-green disabled:opacity-50 disabled:cursor-not-allowed`)
                }
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Cook-in: ingredients summary + cook picker */}
      {meal.mode === "cook_in" && (
        <div className="mt-3">
          {meal.ingredients.length > 0 && (
            <details className="text-xs">
              <summary className={`cursor-pointer ${t.meta}`}>
                {meal.ingredients.length} ingredient{meal.ingredients.length === 1 ? "" : "s"}
              </summary>
              <ul className="mt-2 grid gap-0.5 pl-3">
                {meal.ingredients.map((ing, i) => (
                  <li key={i} className={t.body}>
                    {ing.quantity} {ing.unit} {ing.name}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <div className="mt-3 flex items-center justify-between gap-3 flex-wrap">
            <div className={`text-xs ${t.meta}`}>
              {cookNames.length > 0
                ? <>Cook: <span className={t.body}>{cookNames.join(", ")}</span></>
                : "No cook assigned"}
            </div>
            {canManage && (
              <button
                type="button"
                onClick={() => setShowCookPicker((v) => !v)}
                className={`text-xs ${t.eyebrow} underline`}
              >
                {showCookPicker ? "Done" : "Assign cook"}
              </button>
            )}
          </div>
          {showCookPicker && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {goingMembers.map((mem) => {
                const isOn = meal.assigned_cook_respondent_ids.includes(mem.id);
                return (
                  <button
                    key={mem.id}
                    type="button"
                    onClick={() => {
                      const next = isOn
                        ? meal.assigned_cook_respondent_ids.filter((id) => id !== mem.id)
                        : [...meal.assigned_cook_respondent_ids, mem.id];
                      onSetCooks(next);
                    }}
                    className={
                      "h-8 px-3 rounded-full text-xs font-semibold border transition-colors " +
                      (isOn
                        ? "bg-green text-cream border-green"
                        : `bg-cream ${t.surfaceBorder} text-ink hover:border-green`)
                    }
                  >
                    {mem.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {total > 0 && (
        <p className={`text-[11px] mt-3 ${t.meta}`}>
          {meal.tallies.yes} yes · {meal.tallies.maybe} maybe · {meal.tallies.no} no
        </p>
      )}
    </article>
  );
}

function groupByDay(meals: MealView[]) {
  const map = new Map<string, MealView[]>();
  for (const m of meals) {
    const arr = map.get(m.day_date) ?? [];
    arr.push(m);
    map.set(m.day_date, arr);
  }
  // Sort each day's meals by meal_type order.
  for (const arr of map.values()) {
    arr.sort((a, b) => MEAL_TYPE_ORDER.indexOf(a.meal_type) - MEAL_TYPE_ORDER.indexOf(b.meal_type));
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, items]) => ({ day, items }));
}

function formatDay(day: string): string {
  return new Date(day + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "long", month: "short", day: "numeric",
  });
}
