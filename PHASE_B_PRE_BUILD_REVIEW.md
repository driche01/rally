# Phase B — Pre-Build Review

**Generated:** 2026-05-12
**Branch:** `claude/eager-sanderson-00015d`
**Head commit:** `811ec19` (planner-dashboard cover/theme hero)
**Source guide:** [docs/rally_phase_b_build_guide.md](docs/rally_phase_b_build_guide.md)
**Prior phase docs:** [PHASE_A_DEMO.md](PHASE_A_DEMO.md), [BUILD_QUESTIONS.md](BUILD_QUESTIONS.md), [SCHEMA_REPORT.md](SCHEMA_REPORT.md)

Per CLAUDE.md hard rule + Phase B guide §0, this file is the mandatory reconciliation between the Phase B build guide and the reality Phase A shipped. **Nothing in Phase B's build sequence runs until this is signed off.**

---

## TL;DR

Phase A shipped clean, **plus** four iteration rounds of polish that the build guide didn't anticipate (themes v2, cover image upload, Gemini cover generation, dashboard cover/theme hero). All of it is additive and on-spec.

For Phase B, the biggest issues are **three schema collisions** with pre-existing Expo-app tables: `lodging_options`, `itinerary_blocks`, and `lodging_votes`. The Phase B guide describes building those tables from scratch; the Expo app already owns them. My recommendation is to **extend additively** (same pattern Phase A used for `traveler_profiles` / `respondents` / `thread_messages`), not create parallel `phase_b_*` tables.

I have **8 open questions (Q10–Q17)** below that block Phase B Step 0. The biggest decisions are:
- Q10: the lodging_options reconciliation (extend vs new table)
- Q11: the itinerary_blocks reconciliation (extend vs new table)
- Q14: the AI provider for each tab (Anthropic vs Gemini)
- Q16: dashboard tab UI pattern (top tabs vs accordion)

---

## 1. What Phase A actually shipped (vs. what the Phase B guide assumes)

### What Phase B's guide assumes from Phase A
- All 10 build-guide steps shipped ✓
- Profile capture working end-to-end ✓
- Activity feed live + realtime ✓
- Mutuals minimal version shipped ✓
- Returning-user one-tap confirm shipped ✓
- RSVP nudge cadence wired (if not deployed) ✓

### What actually shipped beyond the guide
1. **Themes v2** — six visually-distinct themes that propagate through the entire invite page (root bg, headline font, eyebrow style, accent color, surface treatment), not just the cover gradient. The picker on `/trips/new` renders each tile as a mini-flyer at thumbnail size.
2. **Cover image upload** — `/api/uploads/cover` route + `trip-covers` public storage bucket (migration 124) + drag-drop dropzone in the trip form. PNG/JPEG/WEBP, ≤5 MB.
3. **Cover image AI generation** — `/api/uploads/generate-cover` route, calls Gemini's image-gen model (`gemini-2.5-flash-image` with two fallback candidates), saves to the same bucket, returns the public URL.
4. **Cover hero on planner dashboard** — `/trips/[id]` mirrors the invitee hero so the planner sees their cover + theme treatment immediately after publishing.
5. **Login error copy** — clarified the "no account on this number" message to nudge toward typo-checking before blaming whitelist state.

All of these are post-handoff iterations; they're committed (`181c3c0`, `e7621bd`, `811ec19`, `d5a7f1c`) and the live behavior matches the build guide intent.

### What's still pending from Phase A (carried into Phase B context)
- **Migration 114 uncommitted** in the parent checkout (applied to prod, file unsync). Suggest committing alongside Phase B migrations.
- **Migration 115 (`trip_nudge_overrides`)** is staged locally but not applied to prod. Independent of Phase B.
- **`sms-rsvp-nudge-scheduler`** edge function written but not deployed + not on pg_cron. Phase A scope; deployment is a pre-alpha task.
- **Web signup screen** doesn't exist. Alpha cohort is manually whitelisted in `profiles`. If alpha grows, this becomes a Phase B side-task. Doesn't block.
- **No GIF picker** in the activity feed composer (text comments only). Deferred from Phase A; reasonable to revisit in Phase B's polish window.
- **The mutuals trigger fires** but only for respondents with `user_id` set. Most invitees don't have a `users.id` yet (no Rally auth account) — the graph is sparse by design until signup is wired or invitees log in to RSVP.

---

## 2. Post-Phase-A schema state

Schema head is migration **124** in the worktree, **also 124** applied to prod. The `supabase_migrations.schema_migrations` table tracks all of 116–124 via the self-registration inserts at the bottom of each file.

### New tables Phase A added (no Phase B conflict)
| Table | Phase B touches? |
|---|---|
| `trip_cohosts` | Yes — cohosts can also generate AI plans, vote, etc. (read-only FK reference) |
| `activity_feed_entries` | Yes — Phase B should auto-post system entries when AI plans land, when lodging is selected, etc. |
| `mutuals` | Yes — Step 10 mutuals upgrade |

### Extended tables (additive, Phase A)
| Table | Added columns | Phase B implication |
|---|---|---|
| `trips` | theme, cover_image_url, description, is_public, budget_min, budget_max | Phase B's flyer step reads these |
| `traveler_profiles` | 5 vibe_*, budget_comfort, vibe_captured_at | The profile aggregation engine reads these |
| `respondents` | rsvp_status, rsvp_status_updated_at, invited_by, invited_at | Aggregation engine filters by `rsvp_status='going'` |
| `thread_messages` | trip_id, message_type | Phase B writes here for any new SMS (planner nudges around lodging votes etc., if added) |

### Pre-existing tables that COLLIDE with Phase B's planned tables

Three are the load-bearing ones. Two are name-only conflicts I can sidestep.

#### `lodging_options` — **HARD COLLISION**

| Phase B wants | Existing column | Compatible? |
|---|---|---|
| `name` (text) | `title` (text) | Same meaning, different name |
| `provider` enum {airbnb,vrbo,booking,hotel,other} | `platform` text | Same meaning |
| `external_url` (text) | `url` (text) | Same meaning |
| `cost_total` numeric | `total_cost_cents` integer | Different unit |
| `cost_per_night` numeric | `nightly_rate_cents` integer | Different unit |
| `room_layout` jsonb | — | New |
| `ai_suggested` boolean | — | New |
| `is_selected` boolean | `status` text default 'option' | `status='selected'` ≈ `is_selected=true` |

**Recommendation:** extend the existing `lodging_options` table. Add `room_layout jsonb`, `ai_suggested boolean default false`. Add `is_selected boolean default false` OR repurpose `status` (already has `'option'` default; we add `'selected'` as a valid value via a CHECK widening). All code reads `title` not `name`, `platform` not `provider`, `total_cost_cents` not `cost_total`. Type the shared TS layer to expose getters that return numbers in dollars.

See **Q10** below.

#### `itinerary_blocks` — **MEDIUM COLLISION**

| Phase B wants | Existing column | Compatible? |
|---|---|---|
| `day_number` integer | `day_date` date | Different concept; date is more useful |
| `category` enum {activity,meal,transit,lodging,free_time,other} | `type` text | Same meaning; CHECK widening would normalize |
| `title` (text) | `title` (text) | ✓ |
| `description` (text) | — (has `notes` text) | Either reuse `notes` or add `description` |
| `location_name` (text) | `location` (text) | Same meaning |
| `location_url` (text) | — | New |
| `ai_generated` boolean | — | New |
| `created_by` uuid → users(id) | — | New |
| `start_time`, `end_time` | ✓ both exist | ✓ |

**Recommendation:** extend `itinerary_blocks`. Add `ai_generated boolean default false`, `created_by uuid references users(id)`, `location_url text`. Reuse `notes` as `description` (or add `description text` separately if we want both). Use `day_date` not `day_number` (more flexible — trips can shift dates). Phase B Step 4's "Generate Itinerary" writes rows into `itinerary_blocks` with `ai_generated=true`.

See **Q11** below.

#### `lodging_votes` — **SOFT COLLISION**

Existing model: presence-only (a row means "this user voted yes for this option"). Phase B wants yes/no/maybe.

**Recommendation:** extend `lodging_votes`. Add `vote text default 'yes' CHECK (vote IN ('yes','no','maybe'))`. Existing rows are valid (default yes). Phase B writes the new column explicitly.

See **Q12**.

#### Non-conflicts (different names, additive)

- `trip_travel_legs` exists (Expo) — Phase B's `travel_arrangements` is a different name. Build new (rather than retrofit `trip_travel_legs`, which has confusing TEXT date columns).
- `ai_itinerary_options` exists (legacy AI cache for the Expo path) — Phase B writes directly into `itinerary_blocks` via the AI generator; leave the legacy cache alone.
- `day_rsvps` exists (Expo) — unrelated to Phase B itinerary voting.

### New tables Phase B needs (no conflict)
- `itinerary_item_votes` (will reference `itinerary_blocks.id` instead of `itinerary_items.id` per Q11)
- `itinerary_item_alternatives` (same rename)
- `itinerary_alternative_options` (same)
- `lodging_room_assignments`
- `travel_arrangements` (new — distinct from `trip_travel_legs`)
- `travel_groupings`
- `travel_grouping_members`
- `meals`
- `meal_ingredients`
- `meal_votes`
- `shopping_list_items`
- `trip_flyers`

12 new tables. All additive, all clean.

---

## 3. The Phase A decisions that constrain Phase B

(From [BUILD_QUESTIONS.md](BUILD_QUESTIONS.md), all RESOLVED.)

| Q | Decision | Phase B implication |
|---|---|---|
| **Q1** — FK targets | planner-side → `profiles(id)`; invitee/SMS-side → `users(id)` | Phase B's votes / room_assignments / travel_arrangements need explicit per-FK decisions (see Q13 below) |
| **Q2** — Profile table | extend `traveler_profiles` (phone-keyed) | Profile aggregation engine queries `traveler_profiles` |
| **Q3** — Memberships | reuse `respondents` for invitees | Anywhere Phase B talks about "going members," it means `respondents WHERE rsvp_status='going'` |
| **Q4** — Activity feed | separate from `trip_audit_events`; uses `activity_feed_entries` | Phase B emits `system` / `planner_post` entries here |
| **Q5** — SMS log | reuse `thread_messages` | Any new Phase B SMS reuses this rail |
| **Q6** — Enums | `text + CHECK` | All Phase B "enum" columns use CHECK |
| **Q7** — SMS cadence isolation | new function, separate from legacy | Phase C concern more than Phase B |
| **Q9** — Auth | phone OTP, manual whitelist | Phase B doesn't change this |

**Net:** the Q1 split (planner → profiles, invitee/SMS → users) keeps biting. Phase B has more "users" references than Phase A (every vote, every cook assignment, every car grouping member). Most of those are members-of-the-trip, who in Phase A's model are `respondents`. **The natural target for most Phase B FKs is `respondents.id`, not `users.id`** — because that's where invitee state lives even when the user hasn't logged in. See **Q13**.

---

## 4. Codebase state for Phase B

### What's in `/web/app`

```
web/app/
  page.tsx                                 ← landing scaffold
  layout.tsx                                ← root
  globals.css                               ← Rally tokens via @theme
  login/                                    ← phone-OTP login
  trips/new/                                ← trip creation form (full)
  trips/[id]/                               ← planner dashboard
    page.tsx
    trip-dashboard.tsx                      ← hero + stats + actions + roster + activity preview
    roster.tsx                              ← filter pills + search + override menu
    invite-modal.tsx                        ← send invitations
  invite/[token]/                           ← public invitation page
    page.tsx
    rsvp-buttons.tsx
    activity-section.tsx
    themes.ts                               ← (DELETED — moved to /web/lib)
    rsvp/                                   ← RSVP flow + profile capture
  api/
    trips/                                  ← CRUD + invitations + activity + memberships
    invite/[token]/                         ← public check/rsvp/comment
    users/me/profile/                       ← traveler profile upsert
    mutuals/                                ← past trip-mates
    uploads/cover/                          ← multipart upload
    uploads/generate-cover/                 ← Gemini image gen
```

### What's in `/web/lib`

```
lib/
  airports.ts        ← IATA mock dataset + searchAirports()
  auth.ts            ← requireAuthUid / requireRallyUserId
  http.ts            ← json envelope helpers
  phone.ts           ← E.164 normalizer
  sb-functions.ts    ← thin client for the OTP edge functions
  twilio.ts          ← server-side sendSms (Node)
  themes.ts          ← per-theme visual tokens
  supabase/
    client.ts        ← browser singleton
    server.ts        ← server + service-role
    middleware.ts    ← session refresh
```

### What Phase B adds (proposed)

```
web/app/trips/[id]/
  ── current: page.tsx, trip-dashboard.tsx, roster.tsx, invite-modal.tsx
  ── new:
  tabs.tsx              ← top-tab navigation (Itinerary / Lodging / Travel / Meals / Shopping)
  itinerary/page.tsx    ← /trips/[id]/itinerary route segment
  itinerary/*.tsx
  lodging/page.tsx
  lodging/*.tsx
  travel/page.tsx
  travel/*.tsx
  meals/page.tsx
  meals/*.tsx
  shopping/page.tsx
  flyer/page.tsx        ← Generate Flyer flow

web/lib/
  ai/
    anthropic.ts        ← Claude API client (for itinerary + meal generation)
    gemini.ts           ← Gemini client (already partial via /api/uploads/generate-cover)
    aggregate.ts        ← profile aggregation service
  flyer/
    render.ts           ← server-side image composition (sharp/satori/canvas?)

web/app/api/trips/[id]/
  profile-aggregate/route.ts    ← Phase B prereq endpoint
  itinerary/generate/route.ts
  itinerary/[itemId]/vote/route.ts
  lodging/suggest/route.ts
  lodging/[optionId]/select/route.ts
  lodging/[optionId]/rooms/[roomLabel]/assign/route.ts
  travel/route.ts
  travel/suggest-flights/route.ts
  meals/generate/route.ts
  meals/[mealId]/vote/route.ts
  shopping/route.ts
  flyer/generate/route.ts
  clone/route.ts                 ← Step 9 (cheap-or-cut)
```

That's a LOT of routes. Phase B is meaningfully larger than Phase A.

### Tabs UI decision

The current `/trips/[id]` page is one long scroll. Phase B adds 5 substantial tabs. Three options:

- **A — Route-segment tabs:** `/trips/[id]/itinerary`, `/trips/[id]/lodging`, etc. Top-tab navigation component that's part of the shared dashboard layout. Each tab is a sub-route. URL is stable, deep-linkable, server-renderable per tab.
- **B — In-page accordion:** keep everything on `/trips/[id]`; sections expand inline. Simpler, less navigation chrome, but the page gets huge and search/scroll behavior gets weird.
- **C — Sheet / modal:** each tab opens as a bottom sheet. Mobile-first, but desktop UX is awkward.

**Recommendation: Option A.** See **Q16**.

---

## 5. Open questions (Q10–Q17)

### Q10: How do we reconcile `lodging_options` conflict?
**Options:** (A) extend additively; (B) new table `trip_lodging_options`.
**Recommendation:** (A) — keep the pattern Phase A used for traveler_profiles / respondents / thread_messages. Status: **AWAITING HUMAN INPUT.**

### Q11: How do we reconcile `itinerary_blocks` conflict?
**Options:** (A) extend additively, use `day_date` not `day_number`, reuse `notes` as `description` (or add `description`); (B) new table `trip_itinerary_items`.
**Recommendation:** (A). Status: **AWAITING HUMAN INPUT.**

### Q12: How do we handle `lodging_votes` extension?
**Options:** (A) add `vote text default 'yes' CHECK (vote IN ('yes','no','maybe'))`; (B) new table `lodging_option_votes` shaped like Phase B's spec.
**Recommendation:** (A) — additive, preserves existing rows. Status: **AWAITING HUMAN INPUT.**

### Q13: Who can vote / be assigned a room / be in a car grouping? `users(id)` or `respondents(id)`?
The Phase B guide says `users(id)` for everything. But most going-members in Phase A are `respondents` rows with NULL `user_id` (no auth account). If we FK to `users(id)`, only authed members can vote — invitees without Rally accounts can't. That breaks the wedge.
**Options:**
- (A) FK to `respondents(id)` for all per-member Phase B tables (votes, room_assignments, travel_arrangements, meal cook assignments, etc.). Anon can vote via session_token, same anon pattern as Phase A's RSVP submission.
- (B) FK to `users(id)` as the guide specifies. Force invitees to sign up before voting / committing to a room / etc. Higher friction; protects against vote spoofing.
- (C) Hybrid: votes are `respondents(id)`, anything financial (room_assignment with cost owed) is `users(id)`.
**Recommendation:** (A) — keep voting anon-friendly. Room assignments + cost owed are gated by the planner who assigns, not by the assignee being authed. Status: **AWAITING HUMAN INPUT.**

### Q14: AI provider per tab — Anthropic or Gemini?
The guide says "Anthropic API" for itinerary + meals, "Gemini with grounding" for lodging + flights. We have both keys.
- **Itinerary:** Anthropic Claude (creative + structured output). Provider: Anthropic.
- **Meals:** Anthropic Claude (creative + dietary-aware). Provider: Anthropic.
- **Lodging suggestions:** Gemini with Google Search grounding (needs real-world prices + availability). Provider: Gemini.
- **Flight suggestions:** Gemini with Google Search grounding (same reason). Provider: Gemini.
- **Cover image generation (already shipped):** Gemini 2.5 Flash Image. Provider: Gemini.
- **Flyer generation:** image composition is not AI — it's server-side rendering. No provider needed.

**Recommendation:** ship Anthropic for itinerary + meals, Gemini for lodging + flights, as the guide says. Decide model names per-call (e.g., `claude-sonnet-4-6` for itinerary). Status: **AWAITING HUMAN INPUT.**

### Q15: Flyer generation rendering path?
Three options:
- (A) Server-side with `@vercel/og` or `satori` — generates PNG from JSX. Mature, fast.
- (B) Server-side with `sharp` for image composition. More control, more work.
- (C) Client-side `<canvas>` — simpler infra but blocks on the user's device.
- (D) Reuse the Gemini image-gen rail with a flyer-specific prompt — clever but quality is unpredictable for text-overlay imagery.

**Recommendation:** (A) `satori` + Resvg, server-side. Predictable output, Insta-story (1080×1920) + post (1080×1080) sizes from one template. Status: **AWAITING HUMAN INPUT.**

### Q16: Dashboard tab UI pattern?
Recommended **Option A — route-segment tabs** above. Each tab is its own URL, RSC-friendly. Status: **AWAITING HUMAN INPUT.**

### Q17: Shopping list ingredient normalization — how aggressive?
Phase B build guide §8 says "deduplication logic: normalize ingredient names (case-insensitive, plural/singular), sum quantities where units match, surface unit conflicts for human resolution." This is non-trivial — "garlic" / "garlic cloves" / "2 cloves garlic" are the same thing in 3 forms.
**Options:**
- (A) Simple normalize (lowercase, strip plurals, exact-name match). Misses semantic equivalents.
- (B) LLM-assisted normalization — let Claude collapse equivalents at meal-plan-generation time, so the meal_ingredients table is already normalized.
- (C) Hybrid: LLM at generation, simple-match at runtime.

**Recommendation:** (B). The aggregation moment is the magic feature; we should make it work right by paying upfront at generation. Status: **AWAITING HUMAN INPUT.**

---

## 6. Recommended Phase B build sequence (after Q10–Q17 resolved)

Assuming the recommendations above are accepted:

1. **Step 0** — schema inspection (re-run, write SCHEMA_REPORT + SCHEMA_PLAN for Phase B's additive changes)
2. **Step 1** — migrations (numbered 125+):
   - 125: extend `lodging_options` (+ room_layout, ai_suggested, status widening)
   - 126: extend `itinerary_blocks` (+ ai_generated, created_by, location_url, description)
   - 127: extend `lodging_votes` (+ vote enum)
   - 128: new tables for itinerary votes + alternatives
   - 129: new tables for lodging room assignments
   - 130: new tables for travel arrangements + groupings + members
   - 131: new tables for meals + meal_ingredients + meal_votes
   - 132: new tables for shopping_list_items
   - 133: new table for trip_flyers
3. **Step 2** — `/api/trips/[id]/profile-aggregate` endpoint + service in `/web/lib/ai/aggregate.ts`
4. **Step 3** — Generate Flyer: `/web/lib/flyer/render.ts` + route + UI button
5. **Step 4** — Itinerary tab (route-segment, generate, vote, edit, alternatives)
6. **Step 5** — Lodging tab (AI suggest, select, room assignments)
7. **Step 6** — Travel tab (per-member arrangements, flight suggest, car groupings)
8. **Step 7** — Meals tab (AI generate, vote, dietary surfacing)
9. **Step 8** — Shopping list (auto-derived from meal_ingredients)
10. **Step 9** — Clone Trip (cheap-or-cut; cap at 3 days)
11. **Step 10** — Roster + Mutuals filter/sort/search upgrades

After each step ships, smoke-test + commit + move on. Same cadence as Phase A.

---

## 7. Things I want to surface that the Phase B guide doesn't mention

1. **The planner dashboard's roster doesn't update in realtime.** Phase A note carried forward. Phase B's voting + room assignment + flight entry are all per-member writes that the planner cares about seeing. Realtime on the dashboard becomes more valuable as Phase B fills in. Suggest: add realtime subscriptions on each tab's primary table (respondents, lodging_options, itinerary_blocks, etc.).
2. **AI cost ceiling.** The build guide doesn't mention rate limits or cost caps. With Anthropic + Gemini both burning tokens per generation, alpha cost could spike. Suggest: add a `phase_b_generation_log` table tracking provider + model + tokens per generation, and cap N generations/trip/day at the route handler level.
3. **The trip-form's "Cover image" upload UX** can be re-used for the flyer's "pick a background image" step — same dropzone component, same upload route. Refactor opportunity.
4. **Themes already define a per-theme `accent` and `surface` set.** Phase B's flyer should consume the trip's theme to pick the flyer template's color palette, so the flyer feels consistent with the invitation page.
5. **The mutuals graph is sparse.** Phase B Step 10's mutuals upgrade adds filter/sort/search, but if the underlying graph has no rows, the UI is empty regardless. Either (a) bootstrap the mutuals table by running the trigger function manually over historical respondents, or (b) accept empty until usage builds.

---

## 8. Recommendation

**Resolve Q10–Q17, then run Phase B Step 0** (schema inspection), then proceed through the 10-step sequence in order.

Specifically: tell me your call on each of Q10–Q17. I'll re-write `SCHEMA_REPORT.md` + `SCHEMA_PLAN.md` for Phase B and stop again for the Step 0 sign-off before any DDL runs.

If any of my recommendations look wrong, override and I'll regenerate. The defaults I've proposed all favor:
- **Additive over parallel** (extend existing tables, don't shadow them)
- **Anon-friendly** (FK to respondents not users where possible)
- **Reuse over rebuild** (themes, upload route, _sms-shared rail)
