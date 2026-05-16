# Build Questions — Phase A

> Per CLAUDE.md hard rule #5: surface tradeoffs, don't guess. Each question carries my recommendation. Resolve before `SCHEMA_PLAN.md` runs.

---

## Q1: Which identity table does each Phase A FK resolve to?
**Context:** Step 0 schema inspection. The Phase A build guide describes a single `users` table; the live schema has three identity tables (`auth.users`, `public.profiles`, `public.users`), each load-bearing.
**The question:** For each Phase A FK that nominally points at "users," which existing table is the target?
**Options:**
- (A) All Phase A FKs target `public.users(id)` for consistency with the build guide wording. `users.auth_user_id` already links back to `auth.users`, so authed paths still resolve. The downside is that `trips.created_by` currently FKs `profiles(id)` — we'd be introducing two conventions on the same row (planner = profile, cohost/invitee/SMS recipient = user).
- (B) Match each FK to whichever existing table the closest analogous FK uses today:
  - `trip_cohosts.user_id → profiles(id)` (mirrors `trip_members.user_id`, since cohosts must have auth accounts)
  - `trip_memberships.user_id → users(id)` (mirrors `respondents.user_id`, since invitees may not have auth yet)
  - `travel_profiles.user_id → users(id)` (mirrors existing `traveler_profiles.user_id`)
  - `activity_feed_entries.user_id → users(id)` for non-planner posts, but planner posts also need to round-trip auth.uid() → users.id via `users.auth_user_id`
  - `sms_messages.recipient_user_id → users(id)` (mirrors `respondents.user_id` and the phone-keyed identity)
  - `mutuals.user_id → users(id)` (the social graph is phone-keyed)
- (C) Build a new abstraction layer (a `unified_users` view) and FK against that. Heavy. Likely the right move *eventually* but premature for Phase A.

**Tradeoffs:**
- (A) is consistent with the build guide's wording but inconsistent with the existing dual-table reality; might cause subtle bugs in planner-side flows that expect `profiles`.
- (B) requires the developer to track which table each FK points at, but the convention is already proven in the existing code. Lowest blast radius.
- (C) is the cleanest long-term answer but violates "no guessing" / "scope" — wait until v2.

**Your recommendation:** **Option B.** It matches the existing convention exactly, which means new tables compose with existing RLS and helper functions (`auth_user_is_trip_member`, etc.) without surprises. The downside (developer ergonomics) is real but better solved by documentation and a typed shared module than by re-architecting the identity model in Phase A.

**Status:** RESOLVED 2026-05-11 — Option B. Planner FKs → `profiles(id)`; invitee/SMS FKs → `users(id)`.

---

## Q2: Reuse `traveler_profiles` or create a new `travel_profiles`?
**Context:** Phase A build guide §4 describes a `travel_profiles` table keyed by `(id uuid)` with `(user_id)` UNIQUE, holding vibe questions + dietary + budget. The existing `traveler_profiles` is keyed by `(phone)` (not user_id) and already has 16 lifestyle columns (sleep_pref, lodging_pref, meal_pref, drinking_pref, physical_limitations, dietary_restrictions, dietary_specifics, activity_types, budget_posture, trip_pace, home_airport, notes, …).
**The question:** Do we extend `traveler_profiles` with Phase A's vibe questions, or create a parallel `travel_profiles` table?
**Options:**
- (A) **Extend `traveler_profiles` additively.** Add `vibe_beach_or_mountain`, `vibe_spa_or_hike`, `vibe_foodie_or_casual`, `vibe_social_or_chill`, `vibe_culture_or_relaxation`, `budget_comfort` columns to the existing table. One profile per phone (existing PK preserved). Phase A reads/writes the same row the Expo app already writes. The Phase A spec's `default_travel_profile_id` FK becomes unnecessary — one profile per phone, no choice of default.
- (B) **Create new `travel_profiles` table** as specified in the build guide. Live alongside `traveler_profiles`. Phase A reads/writes new table. Expo app continues writing to old. Add `users.default_travel_profile_id` FK to the new table.
- (C) Hybrid: create `travel_profiles` with new vibe columns, but make it a logical view over `traveler_profiles + new columns`. Implementation complexity, probably not worth it.

**Tradeoffs:**
- (A) is by far the simplest and avoids data duplication. The user's profile is one row per phone, period. The Expo app and Phase A web app share it. The Tinder-style vibe capture in Phase A backfills the missing columns on first RSVP; users who already have a `traveler_profiles` row (from prior Expo use) keep their existing data and only fill in the vibe fields. **The Expo app's existing read paths are unaffected** because we only add columns it doesn't reference. The Phase A required-at-first-RSVP model becomes "required at first RSVP if your row is missing the vibe fields," which is the same effective behavior.
- (A)'s downside: `traveler_profiles.phone` is the PK, not `user_id`. Phase A's `users.default_travel_profile_id` FK can't point at a uuid surrogate that doesn't exist. Resolution: skip the `default_travel_profile_id` column on `users` entirely — it's redundant given one profile per phone — and look up profiles by `users.phone → traveler_profiles.phone`.
- (B) keeps the spec literal but creates a parallel data model. Users would have two profile rows that must be synced, which is exactly the kind of integrity bug that bites later. Also: the build guide's note explicitly allows the schema to evolve — "Schema should be flexible enough that adding/removing a vibe field doesn't require dropping columns — prefer additively adding new fields and ignoring deprecated ones over renames" — which signals that extending an existing table is acceptable when the data model is right.
- (C) is over-engineered.

**Your recommendation:** **Option A. Extend `traveler_profiles`.** Drop `users.default_travel_profile_id` from the Phase A plan. The profile is one-per-phone, queried by phone, full stop. The vibe questions become additional columns on the existing table.

**Status:** RESOLVED 2026-05-11 — Option A. Extend `traveler_profiles` additively with vibe columns; skip `users.default_travel_profile_id`.

---

## Q3: Reuse `respondents`/`trip_members` or create a new `trip_memberships`?
**Context:** The build guide describes a `trip_memberships` table holding (trip_id, user_id nullable, phone, email, display_name, rsvp_status, rsvp_updated_at, invited_by, invited_at). The live schema has two tables that together cover this:
- `respondents` — public, phone/email-friendly, has `(name, phone, email, user_id nullable, rsvp text)` + `note`. CHECK `rsvp IN ('in','out')`. Used by the public respond/[tripId] page.
- `trip_members` — authed-only, `(trip_id, user_id NOT NULL, role)` FK to `profiles`. Used by the planner dashboard and the cohost-style RLS policies.

**The question:** How do we represent Phase A's invitation/RSVP/cohost state?
**Options:**
- (A) **Reuse `respondents` for invitee state, reuse `trip_members` for cohost state, add Phase A columns additively.**
  - Add to `respondents`: `rsvp_status text` (new column, distinct from `rsvp`, allowing `{invited,going,maybe,cant_go}` via a new CHECK), `rsvp_status_updated_at timestamptz`, `invited_by uuid REFERENCES users(id)`, `invited_at timestamptz`, `display_name text` (the existing `name` is non-null; "display_name" can be the user-overridable version; if the new column feels redundant, skip it and just use `name`).
  - Add to `trip_members`: a new column for cohost permissions IF Phase A semantics differ from `role IN ('planner','member')`. Probably not needed — Phase A cohost = `trip_members.role='planner'` (since planners and cohosts share permission scope per scope doc).
  - **`trip_cohosts` (Phase A's separate join table) becomes unnecessary** — collapse it into `trip_members.role`. But the build guide explicitly lists `trip_cohosts` as a distinct table. Either we follow the spec literally (option B-style for this one), or we deviate intentionally.
- (B) **Create `trip_memberships` + `trip_cohosts` as specified.** Live alongside `respondents` and `trip_members`. Phase A code uses the new tables exclusively. Two-table-pairs in parallel. Painful but spec-literal.
- (C) **Reuse `respondents`; create `trip_cohosts` separately.** Compromise: collapse memberships into the existing `respondents` table (since the data shape is nearly identical and the public-respond RLS posture already matches what Phase A needs), but create a fresh `trip_cohosts` table per spec because the cohost model is genuinely new (multiple cohosts per trip, no role hierarchy beyond planner/cohost).

**Tradeoffs:**
- (A) maximizes reuse but deviates from the spec on `trip_cohosts`. Risk: existing `respondents` RLS policies are wide-open ("Anyone can read respondents"). Phase A's roster page is host-only — the existing policies would over-expose invitee details. Mitigation: layer additional, more restrictive policies, or filter at app layer.
- (B) is clean-slate but doubles the data model. Highest engineering cost. Highest divergence between mobile and web.
- (C) splits the difference. Honors the spec's separation of cohosts from memberships. Reuses the more substantial `respondents` shape for invitees. **My choice if (A) is too aggressive.**

**Your recommendation:** **Option C. Reuse `respondents`; create `trip_cohosts` as a new table.**
- Add Phase A invitee fields to `respondents` additively. New column `rsvp_status` with its own CHECK (the legacy `rsvp` column stays for the Expo poll path; both can co-exist).
- Tighten the public-read RLS only for the new columns, not the table — adding a restrictive INSERT/UPDATE policy gated on share-token or `is_planner` is straightforward.
- Build new `trip_cohosts` per spec. This is a clean new table with composite PK on `(trip_id, user_id)`.
- Phase A code paths read invitee state from `respondents`; cohost state from `trip_cohosts`. Existing `trip_members` is untouched (kept for the authed-account dashboard membership concept the Expo app uses).

**Status:** RESOLVED 2026-05-11 — Option C. Reuse `respondents`, new `trip_cohosts`, leave `trip_members` alone.

---

## Q4: Confirm `activity_feed_entries` is a new table separate from `trip_audit_events`.
**Context:** `trip_audit_events` is the planner-only activity log added in Phase 15. Phase A's `activity_feed_entries` is the invitee-facing social feed on the invitation page (RSVPs, comments, GIFs, system entries). Different audience, different RLS, different content shape.
**The question:** Confirm we build `activity_feed_entries` as a new table rather than overloading `trip_audit_events`.
**Options:**
- (A) **New `activity_feed_entries` table.** Public-readable on the invitation page (anon SELECT via share token), authed INSERT for comments. Distinct from `trip_audit_events`.
- (B) Overload `trip_audit_events` with new `kind` values for invitee comments/RSVPs/GIFs and a new RLS policy granting anon SELECT under share-token conditions.

**Tradeoffs:**
- (A) keeps the planner audit log clean (it's used for "who did what" forensics, not social interaction). RLS stays simple. Performance: hot-path reads from each table don't compete.
- (B) avoids a duplicate table but mixes audit forensics with public social content. The RLS rewrite is invasive and risks regressing planner-only assumptions.

**Your recommendation:** **Option A. New table, clean separation.** This is the conservative choice that respects existing RLS posture.

**Status:** RESOLVED 2026-05-11 — Option A. Build new `activity_feed_entries`, separate from `trip_audit_events`.

---

## Q5: Confirm `sms_messages` is a new table separate from `nudge_sends`.
**Context:** `nudge_sends` is the legacy poll-cadence engine's send log: NOT NULL FK to `trip_session_id`, NULL `participant_id` allowed, no body stored. Phase A's `sms_messages` records the new RSVP nudge with body, recipient phone, twilio_sid, status.
**The question:** Reuse `nudge_sends` (and widen `trip_session_id` to nullable + add new columns) or build new?
**Options:**
- (A) **New `sms_messages` table.** Phase A's RSVP nudge writes here. `nudge_sends` continues to serve the legacy poll cadence.
- (B) Widen `nudge_sends` by adding nullable columns for `recipient_phone`, `message_body`, `status`, etc. Drop the NOT NULL on `trip_session_id`.

**Tradeoffs:**
- (A) avoids touching a NOT NULL column (which would be an alter, violating hard rule #1 if it widens nullability, technically allowed if we're loosening rather than restricting — but it's a structural change to an existing column either way). Cleaner separation.
- (B) consolidates SMS logging. But changing NOT NULL → NULL on an existing column may be a gray area under the schema-safety rule (Phase A guide says "no rename, no drop"; loosening NOT NULL isn't explicitly listed but is a structural change). Risky.

**Your recommendation:** **Option A. New table.** Cleaner, no risk of regressing the legacy cadence engine, and gives Phase A SMS room to evolve without dragging the old engine along.

**Status:** RESOLVED 2026-05-11 — **Option C (new): reuse `thread_messages` + the existing `sendDm()`/`broadcast()` rail.** Drop the new `sms_messages` table from the plan. `thread_messages` is already the outbound send log (body, twilio_sid, delivery_status, error_code). Phase A adds three additive columns to `thread_messages` instead: `trip_id` (nullable FK to `trips`), `message_type` (nullable text), and a partial index. The existing `_sms-shared/dm-sender.ts` helpers are reused for sends. Scheduling for the RSVP nudge runs off `respondents` state (no new schedule table needed for the single Phase A nudge type).

---

## Q6: Enum representation — use `text + CHECK` to match the existing convention.
**Context:** The Phase A build guide describes several columns as "enum: invited, going, maybe, cant_go" etc. The live DB has **zero** Postgres enum types — every existing enum-like column is `text + CHECK (col IN (...))`.
**The question:** Follow the existing convention or introduce real Postgres enum types?
**Options:**
- (A) Use `text + CHECK`, matching the existing convention everywhere.
- (B) Introduce `CREATE TYPE ... AS ENUM` for the new Phase A enums.

**Tradeoffs:**
- (A) is consistent with every other table in the schema. Easier to evolve (adding values is just a CHECK ALTER, dropping is harder either way). The TS layer in the codebase already does string-union enums on the client side.
- (B) gives Postgres-level type safety but adding values requires `ALTER TYPE ADD VALUE`, ordering is hard to change, and dropping values is effectively impossible — which the build guide flags as a concern (vibe schema may evolve).

**Your recommendation:** **Option A.** Match the existing convention. I'll write the DDL with `text + CHECK` everywhere.

**Status:** RESOLVED 2026-05-11 — Option A. `text + CHECK` everywhere.

---

## Q7: SMS / Twilio infrastructure reuse for the Phase A RSVP nudge.
**Context:** The build guide §6 Step 8 says: "Outbound-only, 1:1, never to a group… Voice: playful, personal, link-driven (see scope doc for voice principles). Record every send in `sms_messages` table." The codebase already has `/supabase/functions/sms-nudge-scheduler` and `_sms-shared/` helpers that drive the legacy poll cadence (cadence engine, personalization tokens, body overrides via `trip_nudge_overrides`).
**The question:** Does the Phase A RSVP nudge ride on the existing `sms-nudge-scheduler` edge function (with new cadence definitions) or get its own dedicated function?
**Options:**
- (A) Extend `sms-nudge-scheduler` to recognize a new "rsvp-invite" cadence keyed off `respondents.rsvp_status = 'invited' | 'maybe'`. Reuses Twilio integration, opt-out handling, rate limits, formatting.
- (B) New edge function `sms-invite-nudge` that scans `respondents` directly and sends via Twilio with its own scheduler. Duplicates the Twilio plumbing.

**Tradeoffs:**
- (A) reuses the proven SMS rail and opt-out handling. Risk: tangles two cadence models that have different triggers (poll cadence is session-anchored; RSVP cadence is invitation-anchored).
- (B) cleanly isolates Phase A SMS but requires re-implementing opt-out checks, rate limits, retry logic, Twilio SID storage, etc.

**Your recommendation:** **Option A, but with strict isolation.** Add a new cadence registration to `sms-nudge-scheduler` that operates off Phase A's `sms_messages` queue and reads invitee state from `respondents`. Reuse `_sms-shared/` helpers for personalization + opt-out. Do NOT touch the existing poll-cadence code path. This question is more of a Phase A Step 8 implementation note than a schema decision — flagging now so the schema plan can include `sms_messages.cadence_anchor` or similar if needed.

**Status:** RESOLVED 2026-05-11 — Option A with strict isolation. Extend `sms-nudge-scheduler` with an `rsvp_nudge` cadence reading `respondents` state. Reuse `_sms-shared/` (`dm-sender.ts`, `personalize.ts`, etc.). Note per Q5 revision: queue logic reads/writes `thread_messages`, not a new `sms_messages` table.

---

## Q8: Design Gate — profile capture prototype ready for review

**Context:** Build guide §5 requires a standalone HTML/CSS/JS prototype of the travel-profile capture flow before any real backend wiring begins. This is the hard stop before §6 build sequence.

**Where it is:**
- Path: [web/prototype/profile-capture/](web/prototype/profile-capture/index.html)
- Localhost: `http://localhost:5174` (running via `phase-a-prototype` launch config)
- Start command: `npx -y serve -s web/prototype/profile-capture -l 5174`

**What's in the prototype:**
- 9-step flow: intro → 5 vibe cards (this/that/either) → home airport typeahead → dietary chips (multi-select, skippable) → budget tier (4-tier) → done + summary
- Live timer in the top-right corner (the Design Gate's load-bearing acceptance metric)
- Pager dots that fill in as you progress
- Tap-driven on every step except home airport (one typeahead input)
- "Both/either" is always available on the vibe questions — nobody is forced into a binary
- Done screen shows elapsed time, an answer summary, and a stubbed "RSVP to Tulum bachelorette" CTA
- Restart button on the done screen for re-runs during review
- Mock airport dataset (50 IATA codes) in `airports.js` — production version will wire to a real source
- No backend wiring, no fetches, no persistence — pure frontend

**Verification I ran:**
- End-to-end flow on mobile viewport (375×812). All 8 answers captured correctly.
- Desktop viewport (1280×800). No overflow, card is left-aligned on wide screens; readable.
- Console: zero errors, zero warnings.
- Typeahead with `jfk` returns JFK immediately.
- Multi-select dietary chips toggle independently; Continue counter updates.
- Restart bug fixed mid-build (done card was overlapping intro on reset; now clean).

**What I want feedback on:**
1. **Are these the right 5 vibe questions?** The five from the build guide are encoded in the schema as `vibe_beach_or_mountain`, `vibe_spa_or_hike`, `vibe_foodie_or_casual`, `vibe_social_or_chill`, `vibe_culture_or_relaxation`. If you want different questions, the schema can absorb new columns additively, so the cost of changing one is low — but every change here is a permanent column, so I'd rather lock the set before migration 117 runs.
2. **Prompt phrasing.** I deliberately phrased as plain-English questions ("Where do you wake up?" rather than "Beach or mountain?") with sub-captions ("salt, sun, slow start"). This is the load-bearing "vibe quiz, not a form" moment. If the voice is wrong, tell me now — the answer values stay the same regardless.
3. **Visual treatment.** Warm dark canvas + coral. Serif headlines, sans body. Big tap targets. Subtle pager + timer. Tell me if you'd rather see warm cream/light, less coral, or a totally different mood.
4. **Three options per vibe vs. two + "skip"?** I went with three (this / that / either) to honor the schema's `'both'` value. The build guide allows either. If you'd rather force a binary choice with a "skip" escape hatch, I can swap the third option for a "Skip" affordance.
5. **Order of steps.** Vibe → airport → dietary → budget. Airport is the only typing step, so I put it after the five vibe taps to let the user warm up first. Open to reordering.
6. **Anything that feels wrong on the actual phone.** The biggest risk is that this feels like a form once it leaves the design tool. Walk it on your phone and tell me.

**What's NOT in the prototype** (will be wired up after approval, during Step 5 of §6):
- Real airport dataset
- Profile lookup by phone (returning-user one-tap confirm flow — different screen entirely)
- POST to the API
- RSVP completion handoff
- A11y polish (focus management on step transitions, etc.)
- Tablet / desktop optimization (mobile-first per spec)

**Status:** RESOLVED 2026-05-11 — Design Gate approved. Iteration: emojis swapped for SVG line icons; palette switched from dark/coral to Rally's documented cream/green system. The five vibe questions, prompt phrasing, three-options-per-vibe pattern, step order, and overall flow are locked. The approved prototype becomes the spec for the eventual production wiring in Step 5 of build guide §6. Migrations 116–122 are cleared to execute.

---

# Phase B questions (Q10–Q17)

Raised in [PHASE_B_PRE_BUILD_REVIEW.md](PHASE_B_PRE_BUILD_REVIEW.md). All resolved 2026-05-12 to my recommendations.

## Q10: `lodging_options` reconciliation
**Context:** existing Expo-app `lodging_options` table has overlapping concept (title vs name, platform vs provider, total_cost_cents vs cost_total) but different column names and units.
**Status:** RESOLVED 2026-05-12 — extend additively. Migration adds `room_layout jsonb`, `ai_suggested boolean default false`. Existing `status text default 'option'` widens to also allow `'selected'` (Phase B's `is_selected=true`). Phase B code reads existing column names (`title`, `platform`, `url`, `total_cost_cents`, `nightly_rate_cents`); the shared TS layer exposes dollar-denominated getters.

## Q11: `itinerary_blocks` reconciliation
**Context:** existing Expo-app `itinerary_blocks` has the shape Phase B's `itinerary_items` wants, but with `day_date` instead of `day_number`.
**Status:** RESOLVED 2026-05-12 — extend additively, keep `day_date`. Migration adds `ai_generated boolean default false`, `created_by` (FK respondents(id) per Q13), `location_url text`. Existing `notes text` doubles as Phase B's `description`. Existing `type text` repurposed as Phase B's `category`; widen CHECK to include `{activity, meal, transit, lodging, free_time, other}` and any pre-existing values.

## Q12: `lodging_votes` extension
**Status:** RESOLVED 2026-05-12 — extend additively. Add `vote text default 'yes' CHECK (vote IN ('yes','no','maybe'))`. Existing rows are valid under the default. FK already on respondent_id (no change needed per Q13).

## Q13: Per-member FK target — `users(id)` or `respondents(id)`?
**Status:** RESOLVED 2026-05-12 — `respondents(id)` for all per-member Phase B tables (itinerary votes, lodging votes, room assignments, travel arrangements, travel grouping members, meal votes, meal cook assignments). Anon-friendly: invitees with no Rally account can still vote / be assigned / commit, gated by the session_token they already have from the RSVP flow. Phase B routes that take member input accept `session_token` for anon callers and `auth.uid()` for authed callers, resolving both to a `respondents.id`.

## Q14: AI provider per tab
**Status:** RESOLVED 2026-05-12 — Anthropic Claude for itinerary + meals (creative + structured output). Gemini with Google Search grounding for lodging + flight suggestions (needs real-world prices + availability). Cover image gen (already shipped) stays on Gemini 2.5 Flash Image. Flyer composition is not AI — server-side `satori` rendering.

## Q15: Flyer generation rendering path
**Status:** RESOLVED 2026-05-12 — `@vercel/og` / `satori` server-side rendering. Generates 1080×1920 (Instagram story) and 1080×1080 (Instagram post) from one template per theme. Uses the trip's existing `theme` to pick the template palette so flyer + invitation feel consistent.

## Q16: Dashboard tab UI pattern
**Status:** RESOLVED 2026-05-12 — route-segment tabs. Each tab is `/trips/[id]/<tab>` (itinerary, lodging, travel, meals, shopping). Top-tab nav component in the shared dashboard layout. RSC-friendly, deep-linkable, server-rendered per tab.

## Q17: Shopping-list ingredient normalization
**Status:** RESOLVED 2026-05-12 — LLM-assisted at meal-plan generation time. Claude collapses semantic equivalents ("garlic" / "2 cloves garlic" / "garlic, minced") into a canonical `meal_ingredients` row at generation. Runtime shopping_list_items aggregation is then a simple sum-by-name-and-unit. Trade-off: pay more tokens upfront, ship a normalized dataset.
**Context:** Step 3 (trip creation) needs an authenticated planner. The existing system has `auth.users` + `profiles` + `users` (per Q1) and a phone-OTP login rail used by the Expo app (`request-phone-login-otp` + `verify-phone-login-otp` edge functions). The build guide assumes auth exists but doesn't specify how the web side wires up.
**Options considered:**
- (A) Reuse existing phone-OTP edge functions verbatim. Pre-existing `profiles` row required (alpha cohort manually whitelisted).
- (B) Phone-OTP login + minimal web signup screen that creates `profiles`/`users` rows.
- (C) Email magic link via `supabase.auth.signInWithOtp({email})`. Conflicts with the phone-keyed identity model.

**Status:** RESOLVED 2026-05-11 — Option A. The alpha cohort is small enough that planner records get pre-seeded manually. The login form treats `{ok: true, registered: false}` from the edge function as "you're not on the list" rather than dead-ending the user on a code-entry screen waiting for an SMS that never arrives. If a web signup becomes necessary post-alpha, it lands as a separate question.
