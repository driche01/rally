# Rally v1 — Session Handoff

**Last update:** 2026-05-12
**Worktree:** `/Users/davidriche/Rally/.claude/worktrees/eager-sanderson-00015d`
**Branch:** `claude/eager-sanderson-00015d`
**Tip:** `b07afb3 chore(flyer): remove flyer feature`

---

## Read these first, in order

1. `CLAUDE.md` (hard rules — restate them back to the human before doing anything).
2. `docs/rally_v1_scope.md`.
3. `docs/rally_phase_a_build_guide.md` + `docs/rally_phase_b_build_guide.md`.
4. `docs/rally_phase_c_build_guide.md` if/when starting Phase C.
5. `PHASE_A_DEMO.md`, `PHASE_B_DEMO.md` (localhost handoff docs from the prior phases — both shipped).
6. `BUILD_QUESTIONS.md` (Q1–Q17 all RESOLVED — read the resolutions, don't relitigate).
7. `SCHEMA_REPORT.md`, `SCHEMA_PLAN.md` (current as of post-Phase-B).

The working agreement in `CLAUDE.md` requires a Phase 0 review doc (`PHASE_C_PRE_BUILD_REVIEW.md`) **before any Phase C work**.

---

## State of play

- **Phase A**: ✅ shipped end-to-end against live Supabase. Tag/commit: see `PHASE_A_DEMO.md`.
- **Phase B**: ✅ shipped end-to-end. All 10 steps. Tag/commit: see `PHASE_B_DEMO.md` (90c198b).
- **Polish post-B**: themes v2, AI cover gen, dashboard hero, profile-capture defaults, login error copy, LAN-IP share links.
- **Just removed (b07afb3)**: the Generate Flyer feature — UI, API, lib, woff fonts, qrcode + @fontsource deps. DB tables (`trip_flyers`, `phase_b_generation_log.flyer_render` kind) kept per the additive-only rule. Rationale from user: *"the shareable link is sufficient and the trip page that it lands the respondent on plays the role of the flyer."*
- **Phase C**: not started. Needs the pre-build review per the working agreement.

---

## Hard rules (memorize before acting)

From `CLAUDE.md`:

1. **Schema additive-only.** No DROP / RENAME / NOT-NULL toggle on existing columns. Mobile-app schema is shared.
2. **Don't touch** `/mobile`, `/expo`, or any iOS/Android code.
3. **Step 0 schema inspection is mandatory** in every phase before backend work. Query `information_schema`, write `SCHEMA_REPORT.md` + `SCHEMA_PLAN.md`, wait for sign-off before migrations.
4. **Outbound SMS only in v1.** No inbound parsing.
5. **Unspecified tradeoff → `BUILD_QUESTIONS.md`**, mark `AWAITING HUMAN INPUT`, move on with non-blocked work.
6. **Build guide > scope doc** on implementation questions.
7. **No phase advance without explicit human sign-off.**
8. **Phase A's Design Gate is a hard stop** (already passed for A).

---

## Architecture cheat sheet

### Identity model (DO NOT confuse)
- `auth.users` ← Supabase Auth row.
- `public.profiles(id)` ← planner-side identity, FK target for planner-owned rows. **(BUILD_QUESTIONS Q1)**
- `public.users(id)` ← Rally identity keyed by phone, FK target for invitee/SMS-side rows. **(Q1)**
- `public.respondents(id)` ← per-trip invitee row with anon `session_token`. **All Phase B per-member FKs target this.** **(Q13)**

### Routes
- Planner dashboard: `/trips/[id]/{overview is page.tsx,itinerary,lodging,travel,meals,shopping}`. Shared chrome in `app/trips/[id]/layout.tsx`. **(Q16)**
- Public invite: `/invite/[token]` — anon RSVP + profile capture.
- All six dashboard tabs are `ready=true` post-Phase-B.

### AI providers **(Q14)**
- **Anthropic Claude** (`claude-sonnet-4-6`) — itinerary + meals, strict JSON.
- **Gemini** (`gemini-2.5-flash` → `gemini-2.5-pro` fallback) — lodging + flights w/ `google_search` grounding; cover image gen uses `gemini-2.5-flash-image` (GA, NOT the `-preview` variant — that 404s).
- All calls log to `phase_b_generation_log`.
- Meal-plan LLM normalizes ingredient names so shopping = SUM-BY-(lower(name), unit). **(Q17)**

### SMS
- Uses the existing `_sms-shared/dm-sender.ts` rail (Twilio).
- `thread_messages` (legacy table) extended with `trip_id` + `message_type` — no new `sms_messages` table. **(Q5 revised)**

### Site URL — critical for SMS / cross-device share links
`/web/lib/site-url.ts` resolves base URL in this order:
1. `NEXT_PUBLIC_SITE_URL` env (if set AND non-localhost) → wins for prod.
2. `x-forwarded-*` / Host header off the current request → wins in dev so a LAN IP like `http://192.168.0.231:3000` flows into the share link.
3. `http://localhost:3000` fallback.

**Keep `NEXT_PUBLIC_SITE_URL` empty in `web/.env.local` during dev** — otherwise SMS links go to localhost and phones can't open them.

---

## Schema state

- **134 migrations applied to live prod** (`supabase/migrations/001…134_*.sql`).
- Live DB: project ref `qxpbnixvjtwckuedlrfj`.
- `supabase db push` doesn't work in this env (docker isn't running). Migrations run via `supabase db query --linked < file.sql`.
- **Each new migration must end with an INSERT into `supabase_migrations.schema_migrations`** to self-register. Existing migrations follow that pattern — copy it.
- Dead-but-kept artifacts (additive rule): `trip_flyers`, `phase_b_generation_log.flyer_render` kind, `discount_codes`/`discount_code_redemptions` (already dropped in mobile migration 114 — those are gone for real).

---

## Recent decisions worth remembering

- **Themes v2** (commit e7621bd) — six aggressive variants (classic/eclectic/fancy/literary/digital/elegant). `themeClass()` in `/web/lib/themes.ts` returns a `ThemeStyle` bundle (root, display, body, meta, cover, coverInk, eyebrow, accent, surface, surfaceBorder, label, mood). **Old** `/web/app/invite/[token]/themes.ts` was an orphan — deleted in b07afb3.
- **Login error copy** (d5a7f1c) — nudges toward typo-checking first when the number isn't found (user hit a real typo).
- **Profile-capture defaults** (29fa366) — `ProfileCapture` takes `initial` prop seeded with existing profile so "edit profile" doesn't start blank. `RsvpFlow` passes `existingProfile` through.
- **Cover image gen model**: use `gemini-2.5-flash-image` (GA). The `-preview` suffix variant 404s.
- **Phase B Q-resolutions**: Q10–Q17 in `BUILD_QUESTIONS.md`. Most consequential: Q13 (FKs → respondents.id), Q14 (provider split), Q16 (route-segment tabs), Q17 (LLM-normalized ingredients).

---

## Files of record

| File | What it is |
|---|---|
| `CLAUDE.md` | Hard rules. Re-read every session. |
| `docs/rally_v1_scope.md` | Product spec — the why. |
| `docs/rally_phase_[a\|b\|c]_build_guide.md` | Implementation spec — the how. |
| `SCHEMA_REPORT.md` | Live DB state at start of current phase. Overwrite each phase. |
| `SCHEMA_PLAN.md` | Additive DDL preview for current phase. Overwrite each phase. |
| `BUILD_QUESTIONS.md` | All tradeoff Q&A. Q1–Q17 RESOLVED. |
| `PHASE_A_DEMO.md`, `PHASE_B_DEMO.md` | Localhost handoff docs. |
| `/shared/types.ts` | Canonical DB row types. |
| `/web/lib/themes.ts` | Themes v2. |
| `/web/lib/ai/{anthropic,gemini,aggregate}.ts` | AI plumbing. |
| `/web/lib/site-url.ts` | Share-link base URL resolver. |
| `/web/app/trips/[id]/layout.tsx` | Shared dashboard chrome. |
| `/web/app/trips/[id]/tabs.tsx` | Route-segment tab nav. |
| `supabase/migrations/*.sql` | All migrations (134 applied). |

---

## Gotchas — read these before doing anything mechanical

1. **`npm install` must run from `/web`**, not the worktree root. The worktree root has an Expo `package.json` that's paused for v1; installing there pollutes the wrong tree.
2. **Migrations**: `supabase db query --linked` only (docker isn't up). Each file must `INSERT` into `supabase_migrations.schema_migrations` at the end to self-register. Copy from any recent migration.
3. **`NEXT_PUBLIC_SITE_URL` must be empty/unset in `web/.env.local` in dev.** A `localhost:3000` value will defeat the Host-header derivation and break SMS share links.
4. **Harness file-state bug observed in this branch**: a few `Edit`/`Write` calls reported success but didn't persist. Confirm critical edits by `grep`/`Read` after the fact, especially in long sessions.
5. **`@fontsource` packages don't expose woff files via `exports`** — `require.resolve` for `.woff` fails. The flyer feature used to hit this; flyer is now deleted, but if you ever need to bundle font files, copy them into the repo and read via `fileURLToPath(import.meta.url)`, don't go through package resolution.
6. **Don't touch `/mobile` or `/expo`.** The Expo app is paused.
7. **Don't run `supabase db reset` or anything that re-baselines.** Live DB has user data.
8. **Stale `next dev` → unstyled pages.** Next 15 + Tailwind v4 dev-mode CSS chunking drifts after multi-day uptime + heavy HMR churn — the page HTML asks for `/_next/static/css/app/layout.css` but it 404s, leaving an unstyled DOM that still has all the right classes. Symptoms: one or more pages render naked, network tab shows the CSS link returning 404, the *built* CSS at `/_next/static/css/<hash>.css` still works. Fix: `npm run dev:clean` (added in `web/package.json`) — it `rm -rf .next` and restarts. **Don't debug the page**, restart the dev server first. Recycle proactively if it's been alive more than ~1 day or you just landed a globals.css / `@theme` / new top-level component change.
9. **Netlify deploys for Rally MUST go to the personal `driche01` team — never `cypress-health`.** Rally is personal infra; Cypress Health is the day-job team. Before running `netlify init` / `netlify sites:create` / any deploy command that could create a new project, run `netlify status` and verify the `Teams:` line is `driche01`. If it isn't, `netlify logout && netlify login` with the `driche01@gmail.com` account first. The `rallysurveys.netlify.app` (Expo marketing) site is the ONE Rally project legitimately under `cypress-health` for historical reasons — don't add to it. See `web/DEPLOY.md` § "Hard rule — team".
10. **`main` ≠ deploy.** As of 2026-05-16 the `rally-web` Netlify project's production branch is **`release`**, not `main`. Pushing to `main` does NOTHING on the hosting side — no build, no publish, no cost. Pushing to `release` triggers exactly one Netlify build. To ship the latest `main` to prod: `git push origin origin/main:release`. To roll back: `git push origin <good-sha>:release --force-with-lease`. Don't auto-deploy by piping every `main` commit to `release` — that defeats the cost-control reason the split exists. See `web/DEPLOY.md` § "Branch model — `main` ≠ deploy".

---

## Dev environment

- **Preview servers running** (check with `preview_list`):
  - `rally-web` on port `60971` (the live Next.js dev server)
  - `web-preview` on `5173`, `phase-a-prototype` on `5174` (older, probably can ignore)
- **Live Supabase**: project ref `qxpbnixvjtwckuedlrfj`, region presumably us-east per existing migrations.
- **Twilio**: outbound only, configured in Supabase Edge Function env.
- **Anthropic / Gemini API keys**: in `web/.env.local`.

---

## What's NOT in v1 (don't add)

- Two-way SMS / inbound parsing / NLU.
- Mobile app changes (paused).
- IAP / paywall (deleted in mobile migration 114).
- The `day_rsvps` UI on the public RSVP page (the gated section was deleted 2026-05-03; tables stay because the planner-side itinerary editor still uses them).
- The flyer feature (just removed b07afb3).

---

## When you (the new session) start

1. Open `CLAUDE.md`. Read it fully. Restate the hard rules to the human in your own words.
2. Ask the human what they want to do next (Phase C kickoff? More Phase B polish? Bug fix?).
3. If Phase C: write `PHASE_C_PRE_BUILD_REVIEW.md` per the working agreement before any code.
4. If polish/fix: confirm the preview server is still up (`preview_list`), confirm `web/.env.local` doesn't have a localhost `NEXT_PUBLIC_SITE_URL`, then proceed.
5. Don't relitigate Q1–Q17 — they're in `BUILD_QUESTIONS.md` with rationale.

---

## Open items the prior session didn't get to

- `PHASE_B_DEMO.md` could optionally note the flyer removal, but isn't strictly required since the demo doc was written before the removal and the removal is captured in commit `b07afb3` + this handoff.
- Phase C entirely — has not been started.
- No outstanding bugs the human has flagged.
