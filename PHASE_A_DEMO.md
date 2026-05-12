# Phase A — Localhost Demo

**Status:** ready for human review (build guide §8 handoff).
**Branch:** `claude/eager-sanderson-00015d`.
**Last commit:** `bdcb20e` (Steps 8–10: RSVP nudge cadence + live activity feed + mutuals trigger).

---

## TL;DR

Phase A's wedge — invitation + profile + roster — is live end-to-end against the production Supabase. A planner can log in via phone OTP, create a trip, invite people, watch their RSVPs land, see a live activity feed with comments. An invitee can land on the invitation page (no login), tap Going/Maybe/Can't go, walk the 25-second profile capture flow (or get the one-tap confirm if they've done it before), and have their RSVP propagate to the planner's roster in real time.

What's NOT in Phase A: AI-drafted dashboard tabs (Phase B), full theme variants (light Phase A, polish Phase B), Generate Flyer (Phase B), Clone Trip (Phase B), Planner Blasts (Phase C), profile-completion / booking / pre-trip-summary SMS (Phase C), inbound SMS / two-way conversation (Phase C+), mobile app (v3).

---

## How to run it

### Prereqs
- Node ≥ 18 (this worktree was built on Node 24.14.0)
- Supabase CLI 2.84.2+ (used for `db query --linked` only — docker not required for the dev loop)
- Live Supabase project linked: `qxpbnixvjtwckuedlrfj` (Rally)
- A `profiles` row with both `phone` and `email` filled in for whichever account you're logging in as (per [Q9](BUILD_QUESTIONS.md))

### First run

```bash
# 1. Install web deps
npm --prefix web install

# 2. Set up env. Real values land here from the parent /Users/davidriche/Rally/.env
#    (the helper script in scripts/ doesn't exist yet; copy by hand for now).
cp web/.env.local.example web/.env.local
# Then fill in NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
# SUPABASE_SERVICE_ROLE_KEY, TWILIO_*. The dev session I built in already
# wrote a working .env.local pulled from the parent .env — check it exists
# before re-copying, you'll lose the values otherwise.

# 3. Launch the dev server
npm --prefix web run dev
# → http://localhost:3000

# Optional: the standalone prototype (the Design Gate deliverable)
npx -y serve -s web/prototype/profile-capture -l 5174
# → http://localhost:5174
```

The launch configs in `.claude/launch.json` (`rally-web`, `phase-a-prototype`, `web-preview`) are wired so `preview_start` works inside an agent session too.

### Verify the live schema

```bash
supabase db query --linked "select version, name from supabase_migrations.schema_migrations where version::int >= 116 order by version" -o table
# Should list 116..123 (the seven Phase A migrations + the mutuals trigger).
```

---

## Test scenario — walk it on your phone

This is the script for the alpha demo. The numbered steps map to the build guide §6 sequence.

### Setup (one-time, manual)

1. Confirm your phone is in `profiles`:
   ```sql
   select id, email, phone from profiles where phone = '<your E.164 phone>';
   ```
   If the row exists with both columns, you're ready. If `phone` is null, set it: `update profiles set phone = '+1...' where email = '...';`. If no row exists at all, log in via the Expo app once to bootstrap, then come back.

### Walking the planner side

1. **Open** <http://localhost:3000>. The landing scaffold renders.
2. **Go to** `/login`. Enter your phone, tap "Text me a code." You should get a real SMS from the Rally Twilio number within seconds.
3. **Enter the code**, tap "Sign in." You land on `/trips/new`.
4. **Fill in the trip form** — give it a name (required), pick a theme tile, set dates, type a destination, optionally a description and cover image URL. Tap "Publish trip →".
5. **You land on `/trips/[id]`** — the planner dashboard. Stat tiles show 0/0/0/0 (no one invited yet). The share-link card has a "Copy share link" button.
6. **Tap "Invite people →"** — the modal opens. Add 2–3 friends by name + phone (use E.164: `+15551234567`). The form should pill them up.
7. (Optional) **Type a custom message** in the textarea, watch the 480-char counter.
8. **Tap "Send N invitations →"**. Each recipient should get a real SMS. The modal switches to a "Sent" summary with per-recipient status (sent / failed / dupe / skipped + detail).
9. **The page reloads.** The roster now lists each recipient with status "Invited." The "Invited" stat tile updated. The activity feed shows a "system" entry: "<your name> sent N invitations."

### Walking the invitee side

In an incognito window (or a friend's actual phone):

10. **Open the SMS** and tap the `/invite/<share_token>` link.
11. **The invitation page renders.** Cover banner (theme-driven if no cover image), trip name, dates, hosted-by, cost-per-person card (if set), three RSVP buttons, guest roster, activity feed (with composer).
12. **Tap "Going"** (or any of the three). You land on `/invite/<token>/rsvp?choice=going`.
13. **Type your name + phone**, tap "Continue →". The check API runs.
14. **If this phone has never RSVPed anywhere before:** you get the 8-step vibe-capture flow. Tap through each card. Sub-30-second target.
15. **If the phone has captured a profile before:** you get a "Looks right?" one-tap confirm with the 8-row summary card. Tap "Yes, RSVP me →" or "Edit profile first."
16. **The submit posts to `/api/invite/[token]/rsvp`**. Done screen renders with the green check halo. Tap "Back to the trip."
17. **Back on the invitation page**, your name is now in the "Going" bucket of the roster. The activity feed shows a new "RSVP" entry: "Your Name → going."
18. **Open the planner browser tab** on the trip dashboard — the roster updates on next reload (the dashboard isn't realtime yet — that's Step 9 for the invitation page only).

### Comments + realtime

19. **Back on `/invite/<token>` in a fresh tab**, scroll to the Activity section.
20. **Type a comment**, tap "Post." It appears in the feed instantly.
21. **In a second tab**, open the same invitation URL. Post a different comment. **The first tab sees it appear without reload** — Supabase realtime is wired.

### Roster override (planner)

22. **On the planner dashboard `/trips/[id]`**, find an invitee in the roster.
23. **Tap their status chip** (e.g., "Invited ▾"). A menu appears with "Set to Going / Maybe / Invited / Can't go."
24. **Pick a different status.** The chip updates optimistically. RLS on `respondents` already lets the planner do this.

### Three-day RSVP nudge

The follow-up nudge cadence is deployed-but-not-running for now (see [Open work](#open-work) below). When you're ready:

```bash
# Local manual test
supabase functions deploy sms-rsvp-nudge-scheduler --no-verify-jwt
curl -X POST https://qxpbnixvjtwckuedlrfj.supabase.co/functions/v1/sms-rsvp-nudge-scheduler \
  -H "apikey: <service-role-key>"
```

Returns `{ok: true, scanned, fired, skipped: {dedupe, too_recent, capped, no_phone}}`.

To run automatically every 6 hours, add a pg_cron entry — the snippet is in the doc-comment at the top of `supabase/functions/sms-rsvp-nudge-scheduler/index.ts`.

---

## What landed in Phase A (commit-by-commit)

| Step | Commit | Notes |
|---|---|---|
| Specs + working agreement | `fe4c506` | CLAUDE.md + scope + phase guides committed to worktree |
| Step 0 | `a438e28` | Schema inventory + plan + resolved questions |
| Design Gate | `68f6d58` + `39165f4` | Standalone HTML/CSS/JS prototype; cream/green palette + SVG icons |
| Step 1 | `49fa9a8` | Migrations 116–122 (additive only, zero schema breaks) |
| Step 2 | `f6d6d21` | /web Next.js 15 scaffold + Tailwind v4 + Supabase SSR + API route stubs |
| Step 3 | `daad168` | Phone-OTP login + trip creation form |
| Step 4 | `526222f` | `/invite/[token]` public invitation page |
| Step 5 | `6a62621` | RSVP flow + profile capture (ported prototype) + check/rsvp API |
| Step 6 + 7 | `ceb7561` | Planner dashboard, roster with override, invite modal, real SMS send |
| Steps 8–10 | `bdcb20e` | RSVP nudge cadence + live activity feed + mutuals trigger (migration 123) |

---

## Schema state

23 Phase A schema artifacts applied to prod (all additive):
- **3 new tables:** `trip_cohosts`, `activity_feed_entries`, `mutuals`
- **4 tables extended:** `trips` (+6), `traveler_profiles` (+7 incl. `vibe_captured_at`), `respondents` (+4 RSVP-lifecycle), `thread_messages` (+2: `trip_id`, `message_type`)
- **6 RLS policies, 11 CHECK constraints, 8 indexes** on new tables
- **1 trigger:** `trg_phase_a_mutuals_on_respondent_change`
- **Migration tracker:** versions 116–123 all registered in `supabase_migrations.schema_migrations`

Zero DROPs. Zero RENAMEs. Zero NOT NULL toggles on pre-existing columns. The Expo app's columns are byte-for-byte intact.

See [SCHEMA_REPORT.md](SCHEMA_REPORT.md) for the full pre- and post-Phase-A inventory.

---

## Decisions you made along the way

(All resolved in [BUILD_QUESTIONS.md](BUILD_QUESTIONS.md).)

- **Q1 — Identity FK targets:** planner-side → `profiles(id)`; invitee/SMS-side → `users(id)`. Matches the existing dual-identity model.
- **Q2 — Profile table:** extend `traveler_profiles` (PK on `phone`) additively rather than create a parallel `travel_profiles` table.
- **Q3 — Memberships:** reuse `respondents` for invitees; new `trip_cohosts` table for cohosts; existing `trip_members` untouched.
- **Q4 — Activity feed:** new `activity_feed_entries` table (public-readable), separate from the planner-only `trip_audit_events`.
- **Q5 — SMS log:** reuse `thread_messages` + the existing `sendDm`/`broadcast` rail. Dropped the originally-planned `sms_messages` table; just added `trip_id` + `message_type` columns to thread_messages.
- **Q6 — Enums:** `text + CHECK` everywhere, matching the convention used in every other table.
- **Q7 — SMS cadence isolation:** new `sms-rsvp-nudge-scheduler` function, separate from the legacy `sms-nudge-scheduler`.
- **Q8 — Design Gate:** approved with the icon swap + Rally cream/green repalette.
- **Q9 — Auth:** Option A — reuse existing phone-OTP edge functions. Alpha cohort manually whitelisted in `profiles`.

---

## Known issues + rough edges

### Things that work but could be polished

- **Custom message preview** in the invite modal — placeholder shows `[Planner]`-style tokens but the actual send uses the planner's name. Reviewer-friendly preview pending.
- **The trip-dashboard roster isn't realtime.** It refreshes when you reload the page. Realtime is wired only on the invitation page's activity feed. Adding planner-side realtime is straightforward but cut for scope.
- **The invite modal does a `window.location.reload()`** after a successful send instead of an optimistic state update. Functional, not elegant.
- **Past trip-mates section** in the invite modal renders empty until the mutuals trigger has had a chance to populate. Working as designed — Phase A is meant to bootstrap the graph from this trip's RSVPs forward.
- **Theme variants are thin** — six themes wired, but they differ mostly in cover gradient + eyebrow color. The build guide called this out as acceptable; Partiful-style heavy theme variants are Phase B polish.
- **The login form's button-click occasionally doesn't fire the JS handler** during agent-driven testing (preview_click). `form.requestSubmit()` works fine. I couldn't reproduce on a real device but flagging in case you see it.
- **Apostrophe rendering** in JS-expression strings inside JSX requires curly quotes (`’`) not `&apos;`. Caught one of these mid-build. There may be others.
- **Cohost-side flows aren't exercised in the demo script** — the cohort is just the planner so far. The trip_cohosts table + RLS are wired; UI to invite a cohost is deferred.

### Things that need follow-up before alpha launch

- **Migration 114 is in prod but uncommitted in the parent repo.** Suggest committing `/Users/davidriche/Rally/supabase/migrations/114_drop_paywall_artifacts.sql` separately so the linear migration history is clean.
- **Migration 115 (`trip_nudge_overrides`) exists locally but is NOT applied to prod.** It's referenced by Phase 16.6 SMS work in memory. Decide whether to apply it before Phase B starts or move it.
- **`sms-rsvp-nudge-scheduler` is written but not deployed.** Deploy + add the pg_cron schedule before depending on the 3-day nudge in alpha. The function comment has the snippet.
- **Twilio creds in `/web/.env.local`** were pulled from the parent `.env`. Verify those creds are intended for both web + edge function use and that no rate-limit ceilings need lifting before alpha.
- **No web signup screen.** Per Q9, alpha cohort gets a profiles row manually. If alpha grows past 10–20 people, build a signup pass on /web. Doesn't block Phase B.

### Out-of-scope deferrals (intentional)

- **GIF picker** (Tenor/Giphy) — Phase A ships text comments only.
- **Photo album** — placeholder per build guide.
- **Generate Flyer** — disabled button with "coming in Phase B" tooltip in the invite modal.
- **Clone Trip** — not in Phase A.
- **Multi-channel send** (phone contacts API, email invite) — phone-by-phone manual entry covers Phase A. Web Contacts API is iOS-only with limited reliability; deferred until there's clear alpha demand.
- **Profile completion / booking / pre-trip-summary SMS** — Phase C.
- **Inbound SMS / two-way conversation** — parked until v2 (monetization-blocked).

---

## File map (what changed where)

```
/CLAUDE.md                                  ← working agreement + hard rules
/docs/rally_v1_scope.md                     ← product scope
/docs/rally_phase_a_build_guide.md          ← phase build guide
/SCHEMA_REPORT.md                           ← pre + post Phase A schema inventory
/SCHEMA_PLAN.md                             ← DDL plan that ran
/BUILD_QUESTIONS.md                         ← Q1–Q9, all RESOLVED
/PHASE_A_DEMO.md                            ← this doc

/supabase/migrations/116..122_phase_a_*.sql ← additive Phase A schema
/supabase/migrations/123_phase_a_mutuals_trigger.sql
/supabase/functions/sms-rsvp-nudge-scheduler/
                                            ← Step 8 cadence (deploy + cron pending)
/supabase/config.toml                       ← verify_jwt=false for the new function

/shared/types.ts                            ← single source of truth for DB row shapes

/web/                                       ← Next.js 15 + App Router + Tailwind v4
/web/app/page.tsx                           ← landing scaffold
/web/app/login/                             ← phone-OTP login (Step 3)
/web/app/trips/new/                         ← trip creation form (Step 3)
/web/app/trips/[id]/                        ← planner dashboard (Steps 7 + 6)
/web/app/invite/[token]/                    ← public invitation page (Step 4)
/web/app/invite/[token]/rsvp/               ← RSVP + profile capture (Step 5)
/web/app/api/                               ← all route handlers
/web/lib/                                   ← supabase clients, auth, http, twilio, phone, airports
/web/prototype/profile-capture/             ← Design Gate prototype (frozen reference)
/web/middleware.ts                          ← supabase-ssr session refresh
```

---

## Next steps

1. **Walk the demo script on your real phone.** Note anything that feels wrong.
2. **Decide what blocks Phase B** — typically would be UX polish from the walkthrough + the pre-alpha deployment items above (migration reconciliation, cadence cron, Twilio limits).
3. **Sign off** when ready, and I'll wait for the Phase B build guide before moving on.

Per CLAUDE.md hard rule #7 + build guide §7, I'm stopping here.
