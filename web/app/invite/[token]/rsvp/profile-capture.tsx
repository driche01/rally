"use client";

/**
 * Profile capture flow — port of the prototype.
 * Used by RsvpFlow when the caller has no vibe_captured_at yet.
 *
 * Self-contained: emits onComplete({...}) when the user finishes all
 * 8 questions. Parent owns submit; this component just collects.
 */

import { useState } from "react";
import { Icon } from "./icons";
import { searchAirports } from "@/lib/airports";
import type {
  VibeBeachOrMountain, VibeSpaOrHike, VibeFoodieOrCasual,
  VibeSocialOrChill, VibeCultureOrRelax, BudgetComfort,
  ProfileCaptureInput,
} from "@shared/types";

const STEPS = [
  "vibe-1", "vibe-2", "vibe-3", "vibe-4", "vibe-5",
  "airport", "dietary", "budget",
] as const;
type Step = (typeof STEPS)[number];

interface VibeOption<T> {
  value: T;
  icon: string;
  label: string;
  cap: string;
}

const VIBE_1: VibeOption<VibeBeachOrMountain>[] = [
  { value: "beach",    icon: "i-sun",      label: "Beach",    cap: "salt, sun, slow start" },
  { value: "mountain", icon: "i-mountain", label: "Mountain", cap: "cold air, hot coffee" },
  { value: "both",     icon: "i-half",     label: "Either",   cap: "surprise me" },
];
const VIBE_2: VibeOption<VibeSpaOrHike>[] = [
  { value: "spa",  icon: "i-leaf",       label: "Spa",  cap: "slow it down" },
  { value: "hike", icon: "i-footprints", label: "Hike", cap: "earn the view" },
  { value: "both", icon: "i-shuffle",    label: "Both", cap: "read the room" },
];
const VIBE_3: VibeOption<VibeFoodieOrCasual>[] = [
  { value: "foodie", icon: "i-wine",     label: "A foodie thing", cap: "tasting menus, reservations" },
  { value: "casual", icon: "i-utensils", label: "Casual",         cap: "tacos, dive bars, vibes" },
  { value: "both",   icon: "i-shuffle",  label: "Mix it up",      cap: "one of each" },
];
const VIBE_4: VibeOption<VibeSocialOrChill>[] = [
  { value: "social", icon: "i-sparkles", label: "Out",       cap: "bars, dancing, late" },
  { value: "chill",  icon: "i-moon",     label: "In",        cap: "cards, couch, conversation" },
  { value: "both",   icon: "i-swap",     label: "Switch off", cap: "depends on the night" },
];
const VIBE_5: VibeOption<VibeCultureOrRelax>[] = [
  { value: "culture",    icon: "i-landmark", label: "Saw it all",     cap: "museums, walks, history" },
  { value: "relaxation", icon: "i-waves",    label: "Did nothing",    cap: "book, beach, repeat" },
  { value: "both",       icon: "i-scale",    label: "A bit of both",  cap: "half on, half off" },
];

const DIETARY_OPTIONS = [
  "vegetarian", "vegan", "pescatarian", "gluten_free", "dairy_free",
  "nut_allergy", "shellfish_allergy", "halal", "kosher", "no_pork",
  "no_alcohol",
] as const;
const DIETARY_LABELS: Record<string, string> = {
  vegetarian:        "Vegetarian",
  vegan:             "Vegan",
  pescatarian:       "Pescatarian",
  gluten_free:       "Gluten-free",
  dairy_free:        "Dairy-free",
  nut_allergy:       "Nut allergy",
  shellfish_allergy: "Shellfish allergy",
  halal:             "Halal",
  kosher:            "Kosher",
  no_pork:           "No pork",
  no_alcohol:        "No alcohol",
};

const BUDGET_TIERS: { value: BudgetComfort; mark: string; label: string; range: string }[] = [
  { value: "budget",  mark: "$",    label: "Budget",     range: "Under $500" },
  { value: "mid",     mark: "$$",   label: "Mid",        range: "$500–$1.5k" },
  { value: "premium", mark: "$$$",  label: "Premium",    range: "$1.5k–$3k" },
  { value: "luxury",  mark: "$$$$", label: "No ceiling", range: "$3k+" },
];

export default function ProfileCapture({
  onComplete,
  initial,
}: {
  onComplete: (data: ProfileCaptureInput) => void;
  /** Optional pre-populated values — used by the "Edit profile first"
      escape hatch on the returning-user confirm screen so the user
      doesn't redo answers they've already given. */
  initial?: {
    vibe_beach_or_mountain?: VibeBeachOrMountain | null;
    vibe_spa_or_hike?: VibeSpaOrHike | null;
    vibe_foodie_or_casual?: VibeFoodieOrCasual | null;
    vibe_social_or_chill?: VibeSocialOrChill | null;
    vibe_culture_or_relaxation?: VibeCultureOrRelax | null;
    home_airport?: string | null;
    dietary_restrictions?: string[] | null;
    budget_comfort?: BudgetComfort | null;
  };
}) {
  const [step, setStep] = useState<Step>("vibe-1");
  const [vibe1, setVibe1] = useState<VibeBeachOrMountain | null>(initial?.vibe_beach_or_mountain ?? null);
  const [vibe2, setVibe2] = useState<VibeSpaOrHike | null>(initial?.vibe_spa_or_hike ?? null);
  const [vibe3, setVibe3] = useState<VibeFoodieOrCasual | null>(initial?.vibe_foodie_or_casual ?? null);
  const [vibe4, setVibe4] = useState<VibeSocialOrChill | null>(initial?.vibe_social_or_chill ?? null);
  const [vibe5, setVibe5] = useState<VibeCultureOrRelax | null>(initial?.vibe_culture_or_relaxation ?? null);
  const [airport, setAirport] = useState<string | null>(initial?.home_airport ?? null);
  const [airportInput, setAirportInput] = useState(initial?.home_airport ?? "");
  const [diet, setDiet] = useState<string[]>(initial?.dietary_restrictions ?? []);
  const [budget, setBudget] = useState<BudgetComfort | null>(initial?.budget_comfort ?? null);

  const stepIndex = STEPS.indexOf(step);

  function advance() {
    const next = STEPS[stepIndex + 1];
    if (next) setStep(next);
  }

  function pickAndAdvance<T>(
    setter: (v: T) => void,
    val: T,
    isFinal = false,
  ) {
    setter(val);
    if (isFinal) {
      // Use the most up-to-date budget value for the final emit.
      const finalBudget = (val as unknown) as BudgetComfort;
      onComplete({
        vibe_beach_or_mountain:     vibe1,
        vibe_spa_or_hike:           vibe2,
        vibe_foodie_or_casual:      vibe3,
        vibe_social_or_chill:       vibe4,
        vibe_culture_or_relaxation: vibe5,
        home_airport:               airport,
        dietary_restrictions:       diet,
        budget_comfort:             finalBudget,
      });
      return;
    }
    setTimeout(advance, 200);
  }

  return (
    <div>
      {/* Pager */}
      <div className="flex justify-center gap-1.5 mb-6">
        {STEPS.map((s, i) => (
          <span
            key={s}
            className={
              i < stepIndex
                ? "h-1.5 w-1.5 rounded-full bg-green-soft"
                : i === stepIndex
                ? "h-1.5 w-4 rounded-full bg-green"
                : "h-1.5 w-1.5 rounded-full bg-line"
            }
          />
        ))}
      </div>

      {step === "vibe-1" && (
        <VibeCard
          eyebrow="1 of 6"
          h="Where do you wake up?"
          sub="Pick the one that sounds like your kind of morning."
          options={VIBE_1}
          picked={vibe1}
          onPick={(v) => pickAndAdvance(setVibe1, v)}
        />
      )}
      {step === "vibe-2" && (
        <VibeCard
          eyebrow="2 of 6"
          h="Day off, day on?"
          sub="What's your default move when there's nothing planned?"
          options={VIBE_2}
          picked={vibe2}
          onPick={(v) => pickAndAdvance(setVibe2, v)}
        />
      )}
      {step === "vibe-3" && (
        <VibeCard
          eyebrow="3 of 6"
          h="Dinner on the trip is…"
          sub="No wrong answer. Just calibrating restaurant picks."
          options={VIBE_3}
          picked={vibe3}
          onPick={(v) => pickAndAdvance(setVibe3, v)}
        />
      )}
      {step === "vibe-4" && (
        <VibeCard
          eyebrow="4 of 6"
          h="Nightlife or nightcap?"
          sub="How do you want to spend the after-hours?"
          options={VIBE_4}
          picked={vibe4}
          onPick={(v) => pickAndAdvance(setVibe4, v)}
        />
      )}
      {step === "vibe-5" && (
        <VibeCard
          eyebrow="5 of 6"
          h="Best trip you'd brag about?"
          sub="The story you'd want to tell when you got back."
          options={VIBE_5}
          picked={vibe5}
          onPick={(v) => pickAndAdvance(setVibe5, v)}
        />
      )}

      {step === "airport" && (
        <AirportStep
          input={airportInput}
          onInput={setAirportInput}
          onPick={(code) => { setAirport(code); setAirportInput(code); setTimeout(advance, 200); }}
        />
      )}

      {step === "dietary" && (
        <DietaryStep
          picked={diet}
          onToggle={(v) => setDiet((d) => d.includes(v) ? d.filter((x) => x !== v) : [...d, v])}
          onSkip={() => { setDiet([]); advance(); }}
          onContinue={advance}
        />
      )}

      {step === "budget" && (
        <BudgetStep
          picked={budget}
          onPick={(v) => pickAndAdvance(setBudget, v, true)}
        />
      )}
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────

function VibeCard<T extends string>({
  eyebrow, h, sub, options, picked, onPick,
}: {
  eyebrow: string;
  h: string;
  sub: string;
  options: VibeOption<T>[];
  picked: T | null;
  onPick: (v: T) => void;
}) {
  return (
    <div>
      <p className="text-xs font-bold tracking-widest uppercase text-green mb-3">{eyebrow}</p>
      <h2 className="font-display text-3xl sm:text-4xl leading-[1.08] text-ink mb-3">{h}</h2>
      <p className="text-muted mb-6">{sub}</p>
      <div className="grid gap-2.5 sm:grid-cols-3">
        {options.map((o) => {
          const isOn = picked === o.value;
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => onPick(o.value)}
              className={
                "flex flex-col items-start gap-2 p-4 min-h-[96px] rounded-[18px] border text-left transition-colors " +
                (isOn
                  ? "bg-green border-green text-cream shadow-md"
                  : "bg-card border-line hover:border-green-soft")
              }
            >
              <span className={isOn ? "text-gold" : "text-green"}>
                <Icon id={o.icon} className="w-10 h-10" />
              </span>
              <span className="font-bold text-base">{o.label}</span>
              <span className={"text-xs " + (isOn ? "text-cream/70" : "text-muted")}>{o.cap}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function AirportStep({
  input, onInput, onPick,
}: {
  input: string;
  onInput: (s: string) => void;
  onPick: (code: string) => void;
}) {
  const matches = searchAirports(input);
  return (
    <div>
      <p className="text-xs font-bold tracking-widest uppercase text-green mb-3">6 of 6</p>
      <h2 className="font-display text-3xl sm:text-4xl leading-[1.08] text-ink mb-3">
        Home airport?
      </h2>
      <p className="text-muted mb-6">
        We use it for flight suggestions and to time SMS to your timezone — not anything else.
      </p>
      <div className="grid gap-3">
        <input
          type="text"
          inputMode="search"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          value={input}
          onChange={(e) => onInput(e.target.value)}
          placeholder="City or 3-letter code"
          className="h-14 rounded-xl border border-line bg-card px-4 text-lg text-ink placeholder:text-muted focus:border-green focus:outline-none"
        />
        {matches.length > 0 && (
          <ul className="rounded-xl border border-line bg-card divide-y divide-line overflow-hidden">
            {matches.map((m) => (
              <li key={m.code}>
                <button
                  type="button"
                  onClick={() => onPick(m.code)}
                  className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-green-soft transition-colors"
                >
                  <span className="font-bold text-green tracking-wider">{m.code}</span>
                  <span className="flex-1 text-sm text-ink">{m.name}</span>
                  <span className="text-xs text-muted">{m.city}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function DietaryStep({
  picked, onToggle, onSkip, onContinue,
}: {
  picked: string[];
  onToggle: (v: string) => void;
  onSkip: () => void;
  onContinue: () => void;
}) {
  return (
    <div>
      <p className="text-xs font-bold tracking-widest uppercase text-green mb-3">Quick add-on</p>
      <h2 className="font-display text-3xl sm:text-4xl leading-[1.08] text-ink mb-3">
        Anything we should know at meals?
      </h2>
      <p className="text-muted mb-6">Tap any that apply. Skip if none.</p>
      <div className="flex flex-wrap gap-2 mb-6">
        {DIETARY_OPTIONS.map((opt) => {
          const isOn = picked.includes(opt);
          return (
            <button
              key={opt}
              type="button"
              onClick={() => onToggle(opt)}
              className={
                "px-4 h-10 rounded-full text-sm border transition-colors " +
                (isOn
                  ? "bg-green-soft border-green text-green font-semibold"
                  : "bg-card border-line text-ink")
              }
            >
              {DIETARY_LABELS[opt] ?? opt}
            </button>
          );
        })}
      </div>
      <div className="flex flex-col sm:flex-row sm:justify-end gap-2">
        <button
          type="button"
          onClick={onSkip}
          className="h-12 px-5 rounded-full bg-card text-muted border border-line hover:border-green hover:text-ink"
        >
          None of these
        </button>
        <button
          type="button"
          onClick={onContinue}
          className="h-12 px-6 rounded-full bg-green text-cream font-bold hover:bg-green-2"
        >
          {picked.length > 0 ? `Continue (${picked.length}) →` : "Continue →"}
        </button>
      </div>
    </div>
  );
}

function BudgetStep({
  picked, onPick,
}: {
  picked: BudgetComfort | null;
  onPick: (v: BudgetComfort) => void;
}) {
  return (
    <div>
      <p className="text-xs font-bold tracking-widest uppercase text-green mb-3">Last one</p>
      <h2 className="font-display text-3xl sm:text-4xl leading-[1.08] text-ink mb-3">
        What&apos;s a comfortable trip budget?
      </h2>
      <p className="text-muted mb-6">
        Ballpark per person, including everything. Used to anchor lodging picks.
      </p>
      <div className="grid gap-2.5 sm:grid-cols-2">
        {BUDGET_TIERS.map((t) => {
          const isOn = picked === t.value;
          return (
            <button
              key={t.value}
              type="button"
              onClick={() => onPick(t.value)}
              className={
                "flex flex-col items-start gap-1 p-4 min-h-[96px] rounded-[18px] border text-left transition-colors " +
                (isOn
                  ? "bg-green border-green text-cream shadow-md"
                  : "bg-card border-line hover:border-green-soft")
              }
            >
              <span
                className={
                  "font-display text-xl tracking-wider " +
                  (isOn ? "text-gold" : "text-green")
                }
              >
                {t.mark}
              </span>
              <span className="font-bold text-base">{t.label}</span>
              <span className={"text-xs " + (isOn ? "text-cream/70" : "text-muted")}>
                {t.range}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
