# Phase B — Localhost Demo

**Status:** ready for human review (build guide §7 handoff).
**Branch:** `claude/eager-sanderson-00015d`.
**Last commit:** `caebd16` (Steps 9 + 10: Clone Trip + Roster/Mutuals upgrades).

---

## TL;DR

Phase B turns Rally from "RSVP collector" into "Google Sheet that builds itself." Every dashboard tab is AI-drafted from the group's aggregated travel profiles, then editable + voteable by the group:

- **Profile aggregation engine** — single source of truth that every AI feature consumes.
- **Generate Flyer** — theme-aware Instagram story + post (`satori` SSR, QR-coded RSVP link).
- **Itinerary** — Claude drafts day-by-day items, group votes yes/maybe/no per item.
- **Lodging** — Gemini-grounded suggestions of real listings, voting, planner picks one, drag-style room assignment.
- **Travel** — per-member arrangements (flight / drive / train), Gemini flight suggestions per home airport, car-share groupings.
- **Meals** — Claude drafts breakfast/lunch/dinner per day with normalized ingredients + dietary surfacing + voting + cook assignment.
- **Shopping list** — auto-aggregated from cook-in meals' ingredients, categorized (produce / meat-fish / dairy / pantry / other), assignable, checkable.
- **Clone Trip** — cheap-or-cut version that duplicates metadata + cohosts; nothing else carries over.
- **Roster + Mutuals** — sort + search added to both.

All of it ships on top of Phase A's invitation/RSVP/profile model. Existing Expo paths are untouched.

---

## How to run it

### Prereqs (same as Phase A + two new env vars)
- Node ≥ 18
- Supabase CLI 2.84.2+ (for `db query --linked`)
- `/web/.env.local` populated with **everything** from Phase A *plus*:
  - `ANTHROPIC_API_KEY` (itinerary + meals)
  - `GEMINI_API_KEY` (lodging + flights + cover image)

`web/.env.local.example` documents every var. The session-local `.env.local` was seeded from `/Users/davidriche/Rally/.env` so it already has the keys.

### First run

```bash
cd /Users/davidriche/Rally/.claude/worktrees/eager-sanderson-00015d

# 1. Install web deps (one-time)
npm --prefix web install

# 2. Confirm env
ls web/.env.local

# 3. Launch dev server (port assigned by Next; no longer hardcoded to 3000)
npm --prefix web run dev
# → http://localhost:3000 (or whatever Next picks if 3000 is busy)
```

If port 3000 is busy from a prior session:
```bash
lsof -ti tcp:3000 | xargs kill
```

### Verify the live schema

```bash
supabase db query --linked "select version, name from supabase_migrations.schema_migrations where version::int between 116 and 134 order by version::int" -o table
# Should list 116..124 (Phase A) + 125..134 (Phase B)
```

---

## Test scenario — walk it on your phone

This is the full Phase B alpha demo. Builds on the Phase A scenario from `PHASE_A_DEMO.md`; do the Phase A walkthrough first if you haven't already.

### Setup

1. Confirm your phone is in `profiles` (same as Phase A).
2. Confirm you have ≥ 1 existing trip with dates set + destination set + theme picked + cover image (your Yosemite trips from the Phase A polish round qualify).

### Walking the planner side

**The tabbed dashboard**

1. **Open `/trips/[id]`** — you land on the Overview tab. Theme treatment + cover hero + tab nav at top: Overview, Itinerary, Lodging, Travel, Meals, Shopping. All six are functional.

**Generate flyer**

2. **Tap "Make flyer"** — modal opens. Tap "Generate flyer →". ~3–5 seconds later you get the Story (1080×1920) and Post (1080×1080) variants inline, with Open / Download / Copy URL per format. The flyer's palette + headline font come from the trip's theme.

**Itinerary tab**

3. **Tap "Itinerary"** in the tab nav. Empty state with "Generate itinerary →".
4. **Tap Generate.** Claude calls in ~5–10 seconds. Day-by-day timeline lands; each item has type + time + title + location + notes + an "AI draft" label.
5. **Vote on items.** Tap the 👍 / 🤷 / 👎 cluster on any card. Updates optimistically. Vote tally appears below the card. Hit again to unvote.
6. **Regenerate** wipes the AI items and re-asks Claude. Try changing your trip dates first to see Claude adapt.

**Lodging tab**

7. **Tap "Lodging".** Empty state with "Find lodging →" — gated on destination + dates being set.
8. **Tap Find.** Gemini calls with Google Search grounding (real-world prices/availability). Returns 3-5 cards: AI-suggested label, vote cluster, vote tallies, nightly + total cost in dollars, "Open listing" link to the real listing on Airbnb / VRBO / Booking / hotel site, "Lock it in" button.
9. **Vote yes** on a few. **Lock in** your favorite. The chosen option swaps to a green-soft card with "LOCKED IN" label.
10. **Room layout appears under the selected option.** Each room shows its `beds` description + an "Add someone…" dropdown. Add going members to rooms. Per-room cost-per-person updates.

**Travel tab**

11. **Tap "Travel".** Each going / maybe member gets a card showing their current arrangement (or "no arrangement set yet" + their home airport hint from the traveler profile).
12. **Tap "Suggest flights"** on a member with a home airport set. Gemini grounded → 3-5 real flight options (airline + flight numbers + airports + times + stops + duration + price + Google Flights deep link). Inline below the member list.
13. **Tap "Edit"** on a member. Form swaps fields based on Mode (flight → flight # + airports; drive → seat capacity; etc.). Save.
14. **Ride shares.** Below member list, planner can create a grouping (direction + departure datetime). Each grouping renders member chips; tap to add/remove.

**Meals tab**

15. **Tap "Meals".** Empty state with "Generate meal plan →".
16. **Generate.** Claude returns breakfast / lunch / dinner per trip day, mixing cook-in (with normalized ingredients) and restaurant (with real names + URLs).
17. **Vote on meals.** Same yes/maybe/no cluster as itinerary + lodging.
18. **Cook-in meals expand** to show their ingredients list (collapsed `<details>`).
19. **Assign cooks** (planner). Cook chips toggle per going member. Multi-cook supported.

**Shopping list — the wow moment**

20. **Tap "Shopping".** Empty state if no cook-in meals yet; "Build shopping list →" CTA once you have some.
21. **Tap Build.** The aggregator collapses meal_ingredients across every cook-in meal: same name + same unit → one row with summed quantity. Source-meal-count footnote tells you how many meals contributed to each ingredient.
22. **Categorized** by 🥬 produce / 🥩 meat + fish / 🥛 dairy + fridge / 🥫 pantry / 🧂 other.
23. **Per-item: checkbox** to mark acquired (strikes through + fades the row), and an **Assign-to dropdown** to claim items to specific group members.
24. **"Refresh from meals"** re-aggregates if you regenerate the meal plan; preserves any acquired / assigned state on items whose (name, unit) key didn't change.

**Clone Trip**

25. **Back on Overview, tap "Clone trip".** Confirm in the dialog. You're redirected to a fresh draft with the same name + " (copy)" suffix, same theme + destination + cover + budget; everything else (invitees, itinerary, lodging, travel, meals, shopping) starts empty.

**Roster + Mutuals upgrades**

26. **Roster (Overview tab)** has a sort dropdown (Status default, Name A-Z, Name Z-A, Most recent). Combine with the filter pills + search input.
27. **Invite people → Past trip-mates section** has a sort dropdown (Most shared, Most recent, A-Z) and a search input.

### Walking the invitee side

Phase B doesn't ship a public-facing vote / claim UI on `/invite/[token]` yet — the build guide says "all going members vote," but the wiring lands invitee-side voting in a follow-up. The vote and shopping-claim endpoints already accept `session_token` (the auth model is anon-friendly), so the UI is the only piece left.

Phase A's invite page (cover, theme, RSVP buttons, profile capture, activity feed with comments + realtime) is unchanged.

---

## What landed in Phase B (commit-by-commit)

| Step | Commit | Notes |
|---|---|---|
| Phase 0 review | `40d2d9e` | Pre-build review per CLAUDE.md hard rule |
| Step 0 | `06a671b` | SCHEMA_REPORT refresh + SCHEMA_PLAN + Q10–Q17 resolutions |
| Step 1 | `c3705bd` | Migrations 125–134 — 13 new tables + 3 extended |
| Step 2 | `9d33e4d` | Profile aggregation engine + types |
| Step 3 | `700c856` | Generate Flyer (satori + QR + theme palette) |
| Step 4 | `5c347db` | Itinerary tab + Anthropic + voting + layout-with-tabs refactor |
| Step 5 | `cbac7c8` | Lodging tab + Gemini-grounded suggestions + room assignment |
| Step 6 | `5e2aade` | Travel tab + flight suggestions + ride shares |
| Step 7 | `a06604c` | Meals tab + Claude meal plan + dietary + cooks |
| Step 8 | `4dd23b6` | Shopping list — auto-aggregated, categorized, assignable |
| Steps 9 + 10 | `caebd16` | Clone Trip + Roster sort + Mutuals filter/sort/search |

---

## Schema state (post-Phase-B)

13 new tables + 3 extended tables, all applied (`supabase_migrations` versions 116–134).

**New (Phase B):**
- `itinerary_item_votes`, `itinerary_item_alternatives`, `itinerary_alternative_options`
- `lodging_room_assignments`
- `travel_arrangements`, `travel_groupings`, `travel_grouping_members`
- `meals`, `meal_ingredients`, `meal_votes`
- `shopping_list_items`
- `trip_flyers`
- `phase_b_generation_log` *(my §7 addition — AI cost tracking)*

**Extended (Phase B):**
- `lodging_options`: +`room_layout` jsonb, +`ai_suggested` bool, widened `status` CHECK
- `itinerary_blocks`: +`ai_generated`, +`created_by` (→ respondents), +`location_url`; new `type` CHECK covering both Expo + Phase B values
- `lodging_votes`: +`vote` (yes/no/maybe)

Per Q13, every per-member FK across the 13 new tables targets `respondents(id)` — voting / room assignment / travel / cook assignment / shopping claims all work for invitees who haven't signed up for Rally, gated by their share-link `session_token`.

---

## Decisions (BUILD_QUESTIONS.md Q10–Q17, all RESOLVED 2026-05-12)

| Q | Locked to |
|---|---|
| Q10 | Extend `lodging_options` additively (CHECK widening accepted as non-strict-additive; zero live rows pre-migration so no data risk) |
| Q11 | Extend `itinerary_blocks` additively, keep `day_date` (not `day_number`); CHECK covers both Expo + Phase B values |
| Q12 | Extend `lodging_votes` (+`vote` with default `'yes'` preserving presence-only legacy semantic) |
| Q13 | **All per-member FKs → `respondents(id)`** (the big one — keeps voting/assignment anon-friendly for invitees) |
| Q14 | Anthropic Claude for itinerary + meals; Gemini-grounded for lodging + flight suggest; satori for flyer SSR |
| Q15 | Flyer via `@vercel/og` (satori + resvg) with theme-aware palette |
| Q16 | Route-segment tabs (`/trips/[id]/<tab>`); shared layout owns hero + tab nav |
| Q17 | LLM-assisted ingredient normalization at meal-plan generation time; shopping aggregates by `(lower(name), unit)` |

Q1–Q9 (Phase A) all still binding.

---

## Known issues + rough edges

### Stuff that works but could be polished

- **The planner needs a `respondents` row to vote** on their own trip. If you generate an itinerary on a trip where you haven't self-RSVP'd, vote buttons surface "You don't have an RSVP on this trip yet." Auto-creating a self-respondent on trip creation is a one-line fix; deferred.
- **Auth redirect URL is the bare trip URL.** Hitting `/trips/X/itinerary` unauthed redirects to `/login?next=/trips/X`, not `/login?next=/trips/X/itinerary`. Layout-level redirect only sees the segment params. After login you land on Overview, can tap the right tab.
- **Itinerary alternatives pattern** (A-vs-B grouping) — schema is ready (`itinerary_item_alternatives` + `itinerary_alternative_options`), but no UI ships in Phase B. Follow-up.
- **Real-time updates on votes** — schema + RLS allow it, but no client-side realtime subscription wired for votes. Only the public invitation page's activity feed has realtime (from Phase A).
- **Drag-drop room assignment.** Lodging tab uses a dropdown to add members per room (functional, mobile-friendly), not true drag-drop. Drag-drop is Phase C polish.
- **Arrival/departure timeline view** on Travel tab. Build guide mentions a "timeline view." Phase B ships per-member cards + ride-share groupings; visual timeline (a la a Gantt strip) is a follow-up.
- **No invitee-facing vote / shopping-claim UI** on `/invite/[token]`. The vote + shopping endpoints accept `session_token` so the wiring is in place; just need the UI section.
- **Shopping list unit conflicts** — if Claude emits "garlic / clove" in one meal and "garlic / head" in another, you get two rows for garlic. Phase B v0 surfaces both rows; no automatic conversion. Build guide explicitly says "surface unit conflicts for human resolution" so this is on-spec, but could be smarter.
- **Cost-per-person calc on lodging** assumes flat per-room split. Finer-grained nights-and-share math is deferred.
- **Cover-image fonts on the flyer** fetch from Google Fonts on first call — first flyer render is slow (~5–10s on cold start). Subsequent renders are fast. Could be sped up by inlining font bytes at build time.

### Things to settle before alpha

- **Migrations 114 + 115 in the parent repo** — still uncommitted / unapplied. Phase B doesn't depend on either; same recommendation from Phase A.
- **`sms-rsvp-nudge-scheduler` edge function** — still not deployed + no cron. Phase A scope; Phase B doesn't touch it.
- **AI cost ceiling.** `phase_b_generation_log` table tracks every Anthropic + Gemini call with tokens + duration + error code. Build a daily-cost dashboard before opening up alpha generously. No rate-limit guards yet at the route level; trivial to add if needed.
- **Gemini model rotation.** Lodging + flight suggestions try `gemini-2.5-flash` first, fall back to `gemini-2.5-pro`. If Google retires either, bump the `MODEL_CANDIDATES` constants. Same pattern as the image-gen route already used.
- **Anthropic model name pinned to `claude-sonnet-4-6`.** Default model in `/web/lib/ai/anthropic.ts`. Bump as new model versions ship.
- **The Anthropic + Gemini calls block the route handler thread** for 5–15s. Streaming responses or background queue (`Trigger.dev` / Supabase cron + state polling) would be the production move.

### Out-of-scope deferrals (intentional)

- **Invitee-facing tabs on `/invite/[token]`** for voting on itinerary/lodging/meals — schema + API ready, UI deferred.
- **Native payment + settlement** on lodging — Splitwise link only.
- **Booking integration** — deep links out only.
- **Two-way SMS / inbound parsing** — parked until v2 monetization unlocks the cost.
- **Mobile app** — v3.

---

## File map — new this phase

```
/PHASE_B_PRE_BUILD_REVIEW.md
/PHASE_B_DEMO.md                              ← this doc
/BUILD_QUESTIONS.md                           ← Q10–Q17 RESOLVED

/supabase/migrations/125..134_phase_b_*.sql   ← 10 additive Phase B migrations
/shared/types.ts                              ← TripProfileAggregate + VibeDistribution + group_size_bucket on Trip

/web/lib/ai/aggregate.ts                      ← profile aggregation (pure compute)
/web/lib/ai/anthropic.ts                      ← Claude Messages client (itinerary + meals)
/web/lib/ai/gemini.ts                         ← Gemini Generate Content with optional grounding (lodging + flights)
/web/lib/flyer/render.tsx                     ← satori-based flyer renderer
/web/lib/flyer/fonts.ts                       ← Google-Fonts fetcher + cache

/web/app/trips/[id]/layout.tsx                ← shared hero + tab nav (Phase B refactor)
/web/app/trips/[id]/tabs.tsx                  ← TabNav (Overview / Itinerary / Lodging / Travel / Meals / Shopping)
/web/app/trips/[id]/page.tsx                  ← Overview body
/web/app/trips/[id]/trip-dashboard.tsx        ← Overview client (now includes Clone Trip button)
/web/app/trips/[id]/flyer-modal.tsx           ← Make flyer modal
/web/app/trips/[id]/itinerary/                ← Itinerary tab (server page + client tab)
/web/app/trips/[id]/lodging/                  ← Lodging tab
/web/app/trips/[id]/travel/                   ← Travel tab
/web/app/trips/[id]/meals/                    ← Meals tab
/web/app/trips/[id]/shopping/                 ← Shopping tab

/web/app/api/trips/[id]/profile-aggregate/    ← Phase B prerequisite endpoint
/web/app/api/trips/[id]/flyer/generate/       ← Render + upload + log
/web/app/api/trips/[id]/itinerary/generate/   ← Claude-driven AI generate
/web/app/api/trips/[id]/itinerary/[itemId]/vote/
/web/app/api/trips/[id]/lodging/suggest/      ← Gemini-grounded
/web/app/api/trips/[id]/lodging/[optionId]/select/
/web/app/api/trips/[id]/lodging/[optionId]/vote/
/web/app/api/trips/[id]/lodging/[optionId]/assignments/
/web/app/api/trips/[id]/travel/arrangements/
/web/app/api/trips/[id]/travel/suggest-flights/   ← Gemini-grounded
/web/app/api/trips/[id]/travel/groupings/
/web/app/api/trips/[id]/travel/groupings/[groupingId]/members/
/web/app/api/trips/[id]/meals/generate/       ← Claude-driven, ingredients normalized
/web/app/api/trips/[id]/meals/[mealId]/vote/
/web/app/api/trips/[id]/meals/[mealId]/cooks/
/web/app/api/trips/[id]/shopping/aggregate/   ← dedupe + sum
/web/app/api/trips/[id]/shopping/[itemId]/    ← claim + check off
/web/app/api/trips/[id]/clone/                ← cheap clone
```

---

## Next steps

1. **Walk the full demo script** on your phone. Tell me what feels wrong.
2. **Decide what blocks Phase C** — likely things that surface from walking: invitee-side voting UI, real-time vote updates on the planner side, alternatives pattern, polish on the Gemini-grounded outputs.
3. **Sign off** and share the Phase C build guide. I'll do the Phase 0 pre-build review against the current state before any Phase C code is written, per CLAUDE.md hard rule.

Per CLAUDE.md hard rule #7, stopping here until Phase C sign-off.
