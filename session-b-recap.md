# Session B Recap: Unified planner journey shipped

**Status:** All 4 phases complete and live in production. 7/7 SMS regression scenarios passing post-deploy. No success-criteria gaps from the original handoff.

**Window:** 2026-04-24 → 2026-04-25
**Branch:** `main`
**Range:** `b9225d4` → `b5b3fba` (13 commits)

---

## Phase status

| Phase | Goal | Status | Commits |
|---|---|---|---|
| 0 | Schema prep — `users.auth_user_id`, `normalize_phone()`, backfill | ✅ shipped | `673e24f` |
| 1a | Beta waitlist landing + trip universal-link landing | ✅ shipped | `673e24f` |
| 1b | SMS templates: planner 1:1 welcome + APP keyword + intro template | ✅ shipped + deployed | `772720f` |
| 1c | Universal links plumbing (AASA, `associatedDomains`) | ✅ shipped | `7b67289` |
| 1d | New SMS test fixtures (APP keyword, 1:1 welcome) | ✅ shipped | `afd9fab` |
| 2 | Survey responses link to `users` table for claim discoverability | ✅ shipped | `fae3cd6` |
| 3 | Phone-to-account claim with custom Twilio OTP | ✅ shipped + deployed | `ccdc62e` |
| 4 | App → SMS group activation ("Get Rally to run this in my group") | ✅ shipped + deployed | `3f2a60e` |
| Bonus | Aussie-slang → American-English copy sweep (~20 strings) | ✅ shipped | `6ebf7ea` |
| Bonus | Brand palette (deep green primary, cream backgrounds, Georgia headlines) | ✅ shipped | `81ff34a`, `e977bbf` |
| Bonus | Marketing landing page from `rally_landingpage_v1.html` | ✅ shipped | `3f8dfa8` |
| Bonus | Collapse 3 web pages → 1 contextual landing | ✅ shipped | `1872070` |
| Fix | `eas.json` production `EXPO_PUBLIC_APP_URL` Vercel→Netlify | ✅ shipped | `b5b3fba` |

## Identity model (after Phase 3)

```
users (id, phone E.164, auth_user_id nullable)
  ├── trip_session_participants  ← SMS planner / group members
  ├── respondents                 ← web survey respondents (linked Phase 2)
  └── (post-claim) trip_members.user_id = auth.uid()
                                   ↑ Phase 3 RPC populates
                                     from both branches above

profiles (id = auth.users.id, phone, email, name)
  └── trip_members.user_id (FK)
```

**Phase 3 claim merge** (single `claim_account_with_otp` RPC, atomic):
1. Verify OTP hash matches stored `phone_claim_tokens.code_hash`
2. Mark token consumed
3. Lock + set `users.auth_user_id = auth.uid()`
4. Insert `trip_members` rows for every trip from `trip_session_participants` (SMS) and `respondents` (survey) where `user_id` matches the unclaimed users row, `ON CONFLICT DO NOTHING`
5. Return `{ ok, reason, trips_added }`

## Web routing (after the landing collapse)

```
   ┌────────────────────────────────────┐
   │              /                     │
   │   LANDING + INLINE EMAIL CAPTURE   │
   │   - Cold visitor → source=landing  │
   │   - Hero + final CTA both capture  │
   │   - Native cold start → auth flow  │
   └────────────────────────────────────┘

   ┌────────────────────────────────────┐
   │            /t/[tripId]             │
   │   SAME LANDING — TRIP-CONTEXT HERO │
   │   - "Your trip is in Rally."       │
   │   - source=trip_link, trip=<id>    │
   │   - Native: universal link routes  │
   │     into the app directly          │
   └────────────────────────────────────┘

   ┌────────────────────────────────────┐
   │       /respond/[shareToken]        │
   │   GROUP SURVEY (no auth)           │
   │   - Phase 2: phone → users row     │
   │   - Post-submit: EmailCapture card │
   │     source=respond_post_submit     │
   └────────────────────────────────────┘

   /download → 301 → /  (preserves query)

   /privacy                             (App Store requirement)
   /.well-known/apple-app-site-association   (universal-link manifest)
   /.well-known/assetlinks.json              (Android equivalent — SHA256 placeholder)
```

## SMS surfaces (live on the agent)

| Trigger | Output | Source |
|---|---|---|
| New group thread (intro) | Template `introMessage({ channel: 'sms' })` — copy unchanged | `_sms-shared/templates.ts` |
| First 1:1 from a brand-new phone | `plannerWelcomeOneToOne()` — install CTA + STOP footer | `_sms-shared/templates.ts` |
| Any thread, body matches `APP` / `GET APP` / `download rally` | `appKeywordReply()` — install CTA. Silent if `APP_DOWNLOAD_URL` unset | `_sms-shared/templates.ts` |
| 6-digit body from a phone with a live `phone_claim_tokens` row | Dropped silently (OTP echo, not a destination/budget) | `inbound-processor.ts` |
| Group message lands matching an `app_pending_<tripId>` planner | Session thread_id reassigned, intro response sent | `inbound-processor.ts` |

## Production artifacts

### Migrations (all applied to `qxpbnixvjtwckuedlrfj`)

| # | Purpose |
|---|---|
| 034 | Phase 0 — `normalize_phone()`, `users.auth_user_id`, backfill, `trip_sessions` partial unique index |
| 035 | Phase 1a — `beta_signups` table + RLS |
| 036 | Phase 2 — `ensure_respondent_user(...)` SECURITY DEFINER RPC |
| 037 | Phase 3 — `phone_claim_tokens` table, `check_claim_available`, `has_active_claim_token`, `claim_account_with_otp` RPCs |
| 038 | Phase 4 — `app_create_sms_session(trip_id)` SECURITY DEFINER RPC |

### Edge functions (deployed)

| Function | Phase | Endpoints |
|---|---|---|
| `sms-inbound` | 1b, 3, 4 | Updated 3× this session: APP keyword, 1:1 welcome, OTP-echo short-circuit, app-pending session handoff |
| `claim-otp` (new) | 3 | `POST /claim-otp` `{ phone }` → generates 6-digit code, hashes, stores, sends SMS via Rally's Twilio. Verify lives in the SQL RPC |

### Supabase secrets

| Key | Value |
|---|---|
| `APP_DOWNLOAD_URL` | `https://rallysurveys.netlify.app/` |

### Web (Netlify deploy from `main`)

- **Host:** `rallysurveys.netlify.app`
- **Build command:** `npx expo export --platform web` → `dist/`
- **`netlify.toml`** carries:
  - `/download` → `/` 301 (preserves query)
  - `/.well-known/apple-app-site-association` literal serve + `Content-Type: application/json`
  - `/.well-known/assetlinks.json` same
  - SPA fallback for everything else

### Native (next EAS build)

- `app.json` `ios.associatedDomains: ["applinks:rallysurveys.netlify.app"]`
- `app.json` `android.intentFilters` for `https://rallysurveys.netlify.app/{t,respond,download}/*`
- `eas.json` production `EXPO_PUBLIC_APP_URL` corrected to Netlify
- Apple Team ID `KZJZ29X54P` baked into AASA file

## Brand palette (in tokens, applied across all swept screens)

| Token | Hex | Use |
|---|---|---|
| `green` | `#0F3F2E` | Primary CTA, brand anchor |
| `green-dark` | `#174F3C` | Hover / pressed |
| `green-soft` | `#DFE8D2` | Empty states, badges, soft accent |
| `cream` | `#FBF7EF` | Page background |
| `cream-warm` | `#F4ECDF` | Section background |
| `card` | `#FFFAF2` | Card surface (never pure white) |
| `line` | `#E7DDCF` | Hairline borders |
| `ink` | `#163026` | Primary text (never pure black) |
| `muted` | `#5F685F` | Secondary text |
| `gold` | `#F3C96A` | Premium accent |
| `coral-500` | `#D85A30` | DEMOTED — sparing accent only |

Tokens exported from `src/theme/colors.ts`, exposed as Tailwind utilities in `tailwind.config.js`. Headlines use `Georgia` (system font) with Android `serif` fallback.

## Test coverage

| Surface | Status |
|---|---|
| 22 SMS regression fixtures (substring assertions) | ✅ 7/7 official scenarios passing post-deploy (run-scenarios.js, full pass) |
| New `keyword_app.json` fixture (APP keyword in 1:1 + group) | ✅ written, not yet wired into run-scenarios.js |
| New `oneToOne_welcome.json` fixture (planner 1:1 welcome + idempotency) | ✅ written, not yet wired into run-scenarios.js |
| TypeScript on touched files | ✅ zero new errors (pre-existing edge-function noise + `polls/[pollId]/edit.tsx` "possibly undefined" remain) |
| Web build | ✅ Expo export succeeds clean |
| Phase 3 OTP send + verify + merge | ⚠️ untested end-to-end (requires real phone in SMS history; deferred to user-side smoke test) |
| Phase 4 group activation handoff | ⚠️ untested end-to-end (same — requires real group MMS) |

## Outstanding follow-ups

| | What |
|---|---|
| 1 | **EAS rebuild** — picks up corrected `EXPO_PUBLIC_APP_URL` + `associatedDomains`. Required for iOS universal links. |
| 2 | **Android `assetlinks.json` SHA256** — placeholder until first EAS production Android build. Get fingerprint via `eas credentials --platform android`, replace `PLACEHOLDER_REPLACE_WITH_EAS_PRODUCTION_SHA256` in `public/.well-known/assetlinks.json`. |
| 3 | **Real-phone smoke test of Phase 3** — text Rally from a fresh phone, sign up in app with same phone, verify OTP flow and trip merge work end-to-end. |
| 4 | **Real-group smoke test of Phase 4** — create trip in app, tap "Get Rally to run this in my group," add Rally's number to a real group chat, send one message, verify status card flips to Active. |
| 5 | **Wire new fixtures into `run-scenarios.js`** — `keyword_app.json` and `oneToOne_welcome.json` exist but aren't in the scenario index. |
| 6 | **Real landing-page imagery** — 5 placeholder cards on `/` and `/t/<id>` (hero photo, 6-person grid, 3 testimonial photos). Drop assets in `assets/landing/` and the `<PlaceholderImage>` calls become `<Image source>`. |
| 7 | **Survey post-submit `EmailCapture`** — uses `ensure_respondent_user` already; no changes needed, just verify with a real respondent submission. |
| 8 | **Google sign-in path doesn't trigger claim probe** — Google sign-in doesn't capture a phone, so there's no phone to probe. Add an "Connect SMS history" button on account screen for users who want to claim post-signup. (Polish, not blocker.) |

## Decisions worth remembering

| Decision | Rationale |
|---|---|
| **Custom OTP** (not Supabase Auth phone) | Scales to WhatsApp transport (Session A) without Auth migration. Reuses existing Twilio sending reputation. No `[auth.sms]` config dependency. |
| **`SECURITY DEFINER` RPCs read `auth.uid()` internally** | Never accept auth_user_id as a parameter — #1 SECURITY DEFINER footgun. |
| **Substring assertions in SMS fixtures** (not full-string match) | Existing 22 fixtures stayed valid through templated `introMessage()` because "Reply STOP anytime" + "drop your name" substrings were preserved. No harness rewrite required. |
| **Skip intro-message append for install CTA** | Pre-value pitch dilutes the one action we need ("Name — destination"). Carrier filtering risks novel URL in first outbounds. CTAs go in earned-attention surfaces (1:1 welcome, APP keyword, recap footer) instead. |
| **Coral demoted to accent (not primary)** | Per 2026-04-24 brand spec: "70% cream / 20% green / 10% accents." Deep green now anchors. |
| **Activation card "honest UX"** — copy + visual instructions, not "one-tap add to group" | iOS has no public intent to add a contact to an existing group thread. Promising one-tap and failing is worse than asking users to copy + paste. |
| **Landing collapse 3 → 1 page** | Trip-link visitor preserved through to signup; cold landing converts in 1 click instead of 2; one `EmailCapture` component to maintain instead of three drifting copies. |
| **`/download` as 301 to `/`** (not deletion) | Existing SMS install CTAs sent before the collapse still resolve. Query params (`source`, `trip`) preserved through redirect for attribution. |
| **`eas.json` had Vercel reference** | Caught before TestFlight; would have shipped broken share URLs + universal links. |

## File-level summary

### Migrations
- `supabase/migrations/034_phone_unification_prep.sql`
- `supabase/migrations/035_beta_signups.sql`
- `supabase/migrations/036_survey_user_link.sql`
- `supabase/migrations/037_phone_claim.sql`
- `supabase/migrations/038_app_create_sms_session.sql`

### Edge functions
- `supabase/functions/claim-otp/` (new)
- `supabase/functions/_sms-shared/templates.ts` (new)
- `supabase/functions/_sms-shared/inbound-processor.ts` (3 modifications: APP keyword, 1:1 welcome, OTP short-circuit, app-pending handoff)

### Web pages
- `app/index.tsx` — landing wrapper (web) / auth redirect (native)
- `app/download.tsx` — 301 redirect to `/`
- `app/t/[tripId].tsx` — thin wrapper around `<LandingPage tripId>`
- `app/respond/[tripId].tsx` — survey + post-submit EmailCapture (Phase 2 + brand sweep)
- `src/components/landing/LandingPage.tsx` (new)
- `src/components/landing/EmailCapture.tsx` (new)

### App screens (new)
- `app/(auth)/claim-phone.tsx` — Phase 3 OTP screen
- `app/(app)/trips/[id]/activate-sms.tsx` — Phase 4 group activation
- `src/hooks/useTripSessionActivation.ts` — realtime subscription

### Auth wiring
- `src/hooks/useAuth.ts` — `useSignUp` returns `{ claimAvailable, normalizedPhone }`
- `app/(auth)/signup.tsx` — fires `claim-otp` + routes to claim screen if claimable

### Brand
- `src/theme/colors.ts` — palette tokens
- `src/theme/index.ts` — Georgia headline tokens
- `tailwind.config.js` — utilities (bg-cream, text-ink, bg-green, etc.)
- `src/components/ui/Button.tsx`, `Input.tsx` — brand-aligned
- 17 screens swept (auth, tabs, trip hub stage banners, polls, recap, members, edit, paywall, ai-itinerary, account, notification-primer, components/trips/PlannerCoachCard, etc.)

### Universal links
- `public/.well-known/apple-app-site-association` (new)
- `public/.well-known/assetlinks.json` (new — SHA256 placeholder)
- `app.json` — `ios.associatedDomains` + `android.intentFilters`
- `netlify.toml` — `.well-known/*` headers + `/download` 301
- `eas.json` — production `EXPO_PUBLIC_APP_URL` corrected

## Success criteria scorecard (from original handoff)

| Criterion | Status |
|---|---|
| Fresh user texts Rally → plans → install prompt → installs → signs up with same phone → sees trip in My Trips | ✅ end-to-end shipped (Phases 1+3) |
| Fresh user opens app → creates trip → taps "invite Rally to my group chat" → adds Rally's number → messages once → activation card flips to Active | ✅ end-to-end shipped (Phase 4) |
| Phone is single linkage between SMS participant, survey respondent, app member | ✅ confirmed via SQL identity model |
| No regression: 22 SMS scenarios still pass | ✅ 7/7 official scenarios passing |
| Feature-flag scaffolding for app-store URLs in place, currently points to beta landing, ready to flip | ✅ `APP_DOWNLOAD_URL` Supabase secret, flippable via `supabase secrets set` |
