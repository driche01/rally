# Rally v1 — Alpha Readiness

**Status:** ready for human go/no-go.
**Date:** 2026-05-12.
**Branch:** `claude/eager-sanderson-00015d`.
**Schema head:** `140` (Phase C complete).
**Edge functions deployed:** `sms-rsvp-nudge-scheduler` (polyglot, all 5 reminder types).
**pg_cron:** `phase-c-reminder-scheduler-every-30min` active.

---

## TL;DR — recommendation

**Conditional go.** v1 is feature-complete against the build guide. The polyglot scheduler is live and confirmed working against prod (sent real SMS on first invocation). The web + SMS surfaces work end-to-end across Phases A → B → C. Several deferrals are real but manageable for a small (<10-person) alpha cohort — none are dealbreakers, but a few will sting if alpha scales past that threshold.

**One real blocker before any public-ish rollout: quiet-hours gating isn't wired into the scheduler send loop.** A reminder firing at 3am to a non-test phone would be a self-inflicted reputation hit. For a 5-person trusted-tester alpha where everyone knows what they signed up for, this is acceptable. For anything bigger, fix it first.

---

## What's deployed and runs autonomously

| Surface | Status | Notes |
|---|---|---|
| Web app on Next.js 15 (planner side) | ✅ live | LAN-IP + localhost dev. Production deploy TBD. |
| Public invitation page `/invite/[token]` | ✅ live | Anon RSVP + profile capture + activity feed + realtime comments. |
| Twilio SMS outbound rail | ✅ live | `_sms-shared/dm-sender.ts` + `web/lib/twilio.ts`, both opt-out aware. |
| STOP/REJOIN handling | ✅ live | `sms-inbound` + `users.opted_out`. End-to-end smoke test recommended once at alpha start. |
| Polyglot reminder scheduler | ✅ live | Deployed + pg_cron-scheduled every 30 minutes. Handles all 5 reminder types. |
| Planner blast pipeline | ✅ live | Rate limits + opt-out enforcement + auto-post to activity feed + per-recipient ledger. |
| Cancel trip flow | ✅ live | Locks the trip, cancels pending reminders, notifies guests via SMS, blocks new writes on 5 routes. |
| Stall detection + re-engagement | ✅ live | Both planner SMS + dashboard banner. |
| Phase B AI tabs | ✅ live | Itinerary (Claude), Lodging (Gemini-grounded), Travel (per-member arrangements + Gemini flight suggestions), Meals (Claude + normalized ingredients), Shopping (auto-aggregated). |

---

## Schema state

134 → 140 migrations. All additive. Zero DROPs / RENAMEs / NOT-NULL flips.

- 13 new tables across Phases A + B + C
- 4 tables extended (`trips`, `respondents`, `traveler_profiles`, `thread_messages`, `lodging_options`, `itinerary_blocks`, `lodging_votes`)
- 1 storage bucket (`trip-covers`)
- 1 trigger (`trg_phase_a_mutuals_on_respondent_change`)
- 0 Postgres enum types — `text + CHECK` everywhere per Q6

---

## Decisions log (Phases A + B + C — all RESOLVED)

| # | Phase | Locked to |
|---|---|---|
| Q1 | A | Planner FKs → `profiles(id)`, invitee/SMS FKs → `users(id)` |
| Q2 | A | Extend `traveler_profiles` additively |
| Q3 | A | Reuse `respondents`; new `trip_cohosts`; leave `trip_members` |
| Q4 | A | New `activity_feed_entries` table |
| Q5 | A | Reuse `thread_messages` for SMS log |
| Q6 | A | `text + CHECK` for all enums |
| Q7 | A | New `sms-rsvp-nudge-scheduler`, strict isolation from legacy |
| Q8 | A | Design Gate approved (cream/green palette, SVG icons) |
| Q9 | A | Phone-OTP login, no web signup; alpha cohort manually seeded |
| Q10 | B | Extend `lodging_options` additively |
| Q11 | B | Extend `itinerary_blocks` additively, keep `day_date` |
| Q12 | B | Extend `lodging_votes` with `vote` text |
| Q13 | B | Per-member FKs → `respondents(id)` |
| Q14 | B | Claude for itinerary + meals, Gemini-grounded for lodging + flights |
| Q15 | B | Flyer via `@vercel/og` *(removed entirely 2026-05-12 in b07afb3)* |
| Q16 | B | Route-segment dashboard tabs |
| Q17 | B | LLM-normalized ingredient names |
| Q18 | C | Phase C per-member FKs → `respondents(id)` |
| Q19 | C | SMS log stays on `thread_messages` |
| Q20 | C | `planner_blasts.composed_by → profiles(id)` |
| Q21 | C | Clean new `/api/trips/[id]/blasts` route; legacy `sms-broadcast` on cleanup list |
| Q22 | C | Single polyglot scheduler |
| Q23 | C | Every Phase C send checks `users.opted_out` |
| Q24 | C | Auto-create planner self-respondent on trip create |
| Q25 | C | `home_airport` required at profile capture; static `iata_to_tz` map |
| Q25a | C | Recipients without a profile → sender's local timezone fallback |
| Q26 | C | Suppress opted-out for cancellation notices |

---

## Known issues and risks (ranked)

### Real blockers if alpha grows beyond 10 people

1. **Quiet-hours gating is not wired into the scheduler send loop.** IATA→TZ map is in `shared/iata_to_tz.ts`, the spec is clear, but the polyglot scheduler doesn't yet split sends into "send now" vs "reschedule for next morning in their local tz." For a small trusted-tester alpha this is acceptable; for any wider audience, layer it on before opening up.

2. **Per-recipient 2/24h cross-source limit only applies to blasts.** A recipient could in theory get both an `rsvp_nudge` AND a `planner_blast` in the same 24h. With current cohort sizes this won't happen organically; with anything bigger it will.

### Will sting but won't break alpha

3. **Twilio rate-limit headroom not stress-tested.** Default Twilio outbound is 10 msgs/sec which is plenty for the design (3 blasts/week × ~10 trips × ~10 recipients = at most ~300 SMS/week). Per-day limit on the toll-free number worth confirming with Twilio before opening up.

4. **STOP/REJOIN smoke test deferred.** All the code is in place + `sms-inbound` is deployed. Send one real STOP from a real phone the first day of alpha to confirm carrier routing end-to-end.

5. **`trip_reminder_settings` toggle UI is missing.** The table + RLS + scheduler-respect-the-toggles are all live; just no UI to flip them. Hosts can disable a reminder type by SQL. Build the panel before opening cohost permissions broadly.

6. **AI cost ceiling is uncapped.** `phase_b_generation_log` tracks every Claude + Gemini call with tokens, duration, and error. There's no app-layer rate limit per planner per day. Build the daily-cost dashboard from `phase_b_generation_log` + a sane per-planner cap before alpha grows.

### Latent but probably fine

7. **Stalled-trip detection runs every 30 minutes against every active trip.** Scales to ~10K trips comfortably; past that, add an index or denormalize.

8. **Legacy `sms-broadcast` + `sms-nudge-scheduler` + 4 other SMS edge functions still deployed.** They do nothing in v1 (no data feeds them) but eat code-search noise. Pull the trigger on [LEGACY_CLEANUP.md](LEGACY_CLEANUP.md) in a separate PR after alpha shakes out.

9. **Mobile (`/mobile`, `/expo`) is paused but still in the repo.** That's per CLAUDE.md hard rule #2 (don't touch). Phase C didn't touch any of it.

10. **Re-engagement banner CTA pre-fill.** Stall detector carries a suggested SMS body; "Send a nudge →" opens the blast composer empty. One-liner follow-up.

11. **3 traveler_profiles rows missing `home_airport`** (Q25 requirement). They're dev/seed rows from before the requirement landed. Profile-completion-nudge will eventually catch them; manual SQL fix is faster if alpha needs it.

12. **The 3 `re_engagement` SMS the scheduler fired on first invocation went to David's phone** (test trips matched the `no_itinerary` signal). Same deduplication (21-day window) prevents re-firing.

---

## Out-of-scope (intentional v1 deferrals)

- Two-way SMS / inbound parsing / NLU → **v2 (monetization-unlocked)**
- Integrated booking → **v2**
- Native cost splitting → **v2**
- On-trip mode → **v2**
- Post-trip recap → **v2**
- Mobile app → **v3**
- Anything in Future State → **v3+**

---

## Phase demo docs (for the alpha walk-through)

- [PHASE_A_DEMO.md](PHASE_A_DEMO.md) — invitation + RSVP + profile capture + activity feed
- [PHASE_B_DEMO.md](PHASE_B_DEMO.md) — AI-drafted dashboard tabs + clone trip + roster/mutuals upgrades
- [PHASE_C_DEMO.md](PHASE_C_DEMO.md) — auto reminders + planner blasts + cancel trip + re-engagement

The end-to-end alpha rehearsal walks A → B → C in one sitting.

---

## Pre-alpha checklist (before opening to testers)

- [ ] Walk the end-to-end scenario (Phase A → B → C) on your real phone
- [ ] Confirm STOP routing with one real test (send STOP from a real phone, then trigger a reminder to confirm it's blocked)
- [ ] Stamp the 3 dev `traveler_profiles` rows with `home_airport` values (or wait for profile-completion nudges to do it)
- [ ] Decide on AI cost ceiling: per-planner daily call limit + alert threshold
- [ ] Decide on Twilio rate ceiling: confirm toll-free per-day limit, lift if needed
- [ ] Decide whether to fix quiet-hours before opening to a >10-person cohort
- [ ] Build `trip_reminder_settings` toggle UI before granting cohost permissions broadly
- [ ] Deploy `/web` to production hosting + set `NEXT_PUBLIC_SITE_URL` for the Twilio status callback domain
- [ ] Confirm `TWILIO_STATUS_CALLBACK_URL` points at the live `sms-status-webhook` function so delivery receipts get logged

---

## What ships at alpha

A complete planner experience for an outbound-SMS-driven group trip product:

1. **Sign in** (phone OTP, alpha cohort manually whitelisted).
2. **Create a trip** with theme + dates + destination + cover image (AI-generated or uploaded).
3. **Invite people** by phone + name. They receive a Twilio SMS with the invitation link.
4. **Each invitee** lands on the public trip page, RSVPs (Going/Maybe/Can't go), walks the 25-second vibe + profile capture (home_airport now required).
5. **Planner sees** the roster fill in live + a stat-tile dashboard + an activity feed.
6. **Once enough people RSVP**, the dashboard's six AI-drafted tabs (Itinerary / Lodging / Travel / Meals / Shopping / Overview) come online. Each is votable + editable + assignable.
7. **Auto reminders fire** every 30 minutes via pg_cron + the polyglot scheduler:
   - `rsvp_nudge` to invitees 3 days after invitation
   - `profile_completion_nudge` if RSVP-going but profile incomplete
   - `booking_nudge` 14d and 7d before trip if no travel/lodging
   - `pre_trip_summary` 3 days before trip
   - `re_engagement` to planner if the trip stalls
8. **Planner can send blasts** to any segment (Going / Maybe / Invited / Everyone) with rate limits, opt-out enforcement, and auto-post to feed.
9. **Cancel trip** notifies everyone via SMS and locks the trip page.
10. **STOP keyword** opts the recipient out from all future Rally SMS.

The full outbound-SMS coverage matches the scope doc's voice-aligned, link-driven, no-NLU-needed pattern. Everything works against real Twilio + real Supabase Postgres.

---

## Go/no-go

**My recommendation:** ship to a 3–5 person trusted-tester alpha now. The remaining polish (quiet-hours, per-recipient cross-source rate limits, reminder-settings UI, AI cost dashboard) is real but ranked below the size of the audience at this stage. Each can land in a 30-minute follow-up commit.

**If the user list is bigger or includes anyone not on the build team:** fix quiet-hours first. Everything else is acceptable to layer on while alpha is running.

Per CLAUDE.md hard rule + scope: **stopping here for human go/no-go.**
