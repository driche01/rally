# Rally — Full Technical Review (2026-07-08)

**Reviewer approach:** 8 specialist passes over the live v1 surface (`web/`, `supabase/functions/`, `supabase/migrations/`, `shared/`), every finding then challenged by independent skeptic agents before it earned a place here. High-severity items got a 3-vote adversarial check. Mobile (`app/`, `src/`) and the prototype were out of scope per project rules. `tsc --noEmit` and `next build` both pass clean today.

**Nothing in this document has been changed in the code.** These are recommendations for your signoff.

**Headline verdict:** The product logic is in good shape and the build is green. The risk is concentrated in three places, all typical of a fast-moving pre-launch alpha: (1) the "secret link" model isn't actually enforced by the database, (2) several money-spending endpoints have no limits, and (3) the SMS engine — the part that touches real phones — has reliability and compliance gaps with almost no automated safety net. None of this blocks your *current* whitelisted alpha. Most of it blocks *public* launch.

A note on how to read severity: findings were rated for a **small, trusted, whitelisted alpha**. Several "high" items become "critical" the moment a non-whitelisted stranger can sign up.

---

## Tier 1 — Ship-blockers (fix before any non-whitelisted user)

### 1.1 Account takeover through the RSVP → "promote" flow
- **Where:** `web/app/api/account/promote-from-session/route.ts` + `web/app/api/invite/[token]/rsvp/route.ts`
- **From:** When someone RSVPs, they type their own phone number (unverified), and the server hands back a browser cookie tied to that phone. A second endpoint trusts that cookie: if the phone matches an existing Rally account, it mints a real login for that account and returns it.
- **To:** Never treat a self-typed RSVP phone as proof of identity. Only auto-create a brand-new throwaway account from that cookie; before ever logging someone into an *existing* account, require an SMS one-time-code (the real login path already does this — this endpoint just skips it).
- **Impact:** Today, anyone who knows your phone number + has any invite link can log in *as you* — read your trips and your guests' personal info, send texts and run AI on your bill, cancel your trips. It needs no password and no secret. This is the single most important fix. (Verified end-to-end by 3 independent reviewers; the code's own comments acknowledge it as a deferred risk.)

### 1.2 The "secret link" is not a real security boundary
- **Where:** `supabase/migrations/013_trip_visibility_rls.sql` (root cause) + `web/app/api/trips/[id]/route.ts`, `.../activity/route.ts`, activity-feed tables
- **From:** The browser talks to the database with a public key that is supposed to be locked down by row-level rules. But the rule for trips is literally "if you're an anonymous visitor, you can read **everything**." The share-link secrecy is enforced only in the page code, not in the database — so a few lines of script (no login) can list every trip, host, destination, date, and private invite link in the system. The same applies to activity-feed comments/photos across all trips.
- **To:** Stop reading trips through the open table. Route anonymous reads through a controlled database function that requires the caller to prove they know a specific share token (the codebase already uses this exact pattern for traveler profiles). Then remove the "anyone anonymous can read all" rule.
- **Impact:** Right now every trip your users create is scrapeable by a stranger, including the "private" link that lets someone into each group. For a trust-based social product this is a cross-customer privacy breach and an embarrassing one to explain publicly. (Verified: the browser genuinely uses the RLS-bound public key, confirmed in `web/lib/supabase/client.ts`.)

### 1.3 Guest phone numbers, emails, and session tokens are in the invite page's source
- **Where:** `web/app/invite/[token]/page.tsx` → `crew-section.tsx` / `crew-browser-modal.tsx`
- **From:** The public invite page loads the *entire* guest record (`select("*")`) and passes it into browser components. Everything passed to a browser component ends up in the page source — including each guest's phone, email, and **session token** (the very credential that lets someone act as that guest).
- **To:** Build a small "safe" version of each guest server-side — name, first name, RSVP status, avatar only — and pass *only that* to the browser. Do the "is this me?" check on the server.
- **Impact:** Anyone with an invite link (designed to be forwarded freely) can view-source and harvest the whole group's phone numbers, then impersonate any guest's RSVP and comments by copying their token. One screenshot of this ends the alpha. (Verified by 3 reviewers.)

### 1.4 SMS webhooks can be forged by anyone
- **Where:** `supabase/functions/sms-inbound/index.ts`, `sms-status-webhook`, `_sms-shared/twilio.ts`
- **From:** These public endpoints are only protected by a Twilio signature — but the code only checks the signature *if a signature header is present*. Omit the header and the check is skipped entirely.
- **To:** If the Twilio secret is configured, reject any request that lacks a valid signature (403), before touching the database. Only allow unsigned requests behind an explicit local-dev flag. (Also: the signature comparison isn't constant-time despite its comment — fix alongside.)
- **Impact:** A stranger with just the public URL can POST a fake "STOP" as any customer's number and silently unsubscribe them from all Rally texts (one victim or everyone), inject fake inbound messages, and forge "delivered" statuses to hide real failures. (Verified by 3 reviewers.)

### 1.5 An open endpoint lets anyone send texts on your Twilio bill
- **Where:** `supabase/functions/sms-survey-confirmation/index.ts`
- **From:** This endpoint takes `{trip_id, phone, rsvp}` with no proof the caller is who they say, and no check that the phone even belongs to the trip. Its "one send per day" protection is actually a 60-second in-memory cache that resets constantly.
- **To:** Require the trip's share token or the guest's session token, confirm the phone belongs to a real guest on that trip *before* sending, and move the daily de-dupe into the database.
- **Impact:** Anyone (or a buggy retry loop) can text arbitrary strangers on your personal Twilio bill and get your number flagged for spam; they can also silently kick real members off a trip by forging a decline. (Verified by 3 reviewers.)

### 1.6 Every Phase-C reminder text goes out broken — no name, no trip, no link
- **Where:** `supabase/functions/sms-rsvp-nudge-scheduler/index.ts` (the queue-drain pass)
- **From:** The reminder builder fills in placeholders `[Name]`, `[Trip]`, `[Survey link]`, then calls the personalizer with the **wrong field names**, so every placeholder resolves to nothing. Recipients get: *"👀 there, heads-up on the trip — haven't seen your RSVP yet. Two taps: "* — with no actual link.
- **To:** Pass the correct fields (`recipientName`, `tripName`, `destination`, `surveyUrl`). Add one test asserting a real name and a real link appear.
- **Impact:** Your automated reminders are unusable *and* you pay Twilio for each one. A broken robotext with a dangling "two taps:" and no link is exactly what makes people reply STOP. (Verified by 3 reviewers.)

---

## Tier 2 — Money leaks (no attacker needed; a curious user or a bot is enough)

Common theme: paid endpoints (AI, Google Places, Giphy, Twilio, storage) have **no rate limits, no per-user quotas, and often no login requirement**. Because billing is personal, every one of these is your credit card.

| Recommendation | From → To | Why it matters (plain English) |
|---|---|---|
| **Rate-limit the 6 AI generators** (`generate-cover`, `generate-avatar`, `itinerary/generate`, `meals/generate`, `suggest-lodging`, `suggest-travel`/flights) | From: unlimited calls per logged-in user. To: a per-user daily cap using the existing `phase_b_generation_log` table; return 429 past the cap; log image generations too. | One logged-in user in a loop can burn your Gemini/Anthropic image + grounded-search credits overnight. Flight suggestions are the priciest and cache nothing, so re-clicking re-pays every time. |
| **Lock down Google Places autocomplete** (`places-autocomplete`) | From: open proxy, fires **2 requests per keystroke**, billing session tokens never closed. To: require a login (or per-IP throttle), send one request per keystroke, close the billing session. | Typing one destination costs ~8–12 billed Places calls today. Halving requests + closing sessions cuts legit spend 50–70%; the open URL is a spam-the-bill target. |
| **Shrink AI images before storing** (`generate-cover`, `generate-avatar`) | From: raw 1–2 MB PNGs stored and served unoptimized on the public invite page. To: re-encode to ~150–250 KB JPEG/WebP at save time. | The invite page (the one you *want* going viral) ships a 1–2 MB image per view. 1,000 views ≈ 1–2 GB egress; the free tier is 5 GB/month total. |
| **Authenticate/throttle `restaurant-details`, `suggest-*`** | From: public, unauthenticated, un-throttled Google Places / Gemini proxies. To: require a valid login + confirm trip membership + short cache. | Anyone can loop these to drain your Google/Gemini quota or overwrite the cached suggestions real planners see. |
| **Gate `gifs/search` (Giphy) and validate uploads** | From: open Giphy proxy; uploads trust the client's file-type label. To: require a session + rate-limit; sniff real image bytes server-side. | Outsiders can exhaust the shared Giphy key (kills the feature for everyone) and stash non-image files on your public domain. |
| **Cap `feed-photo` uploads + verify trip membership** | From: anyone who ever RSVP'd can upload unlimited 5 MB files anywhere. To: rate-limit + confirm the uploader belongs to that trip + validate bytes. | Free public file hosting on your bill, including content you would not want associated with Rally. |
| **Delete replaced storage files** | From: every avatar/cover change orphans the old file forever. To: best-effort delete of the previous file after a successful update. | Slow leak; a user trying 10 avatar prompts orphans ~15 MB that keeps serving egress. |

---

## Tier 3 — SMS reliability & compliance (touches real phones; almost no tests)

| Recommendation | From → To | Why it matters |
|---|---|---|
| **Make sends idempotent (stop double-texting)** — schedulers + broadcasts | From: pick unsent rows → send → *then* mark sent; only guard is a 60-sec in-memory cache. To: atomically claim each row *before* sending (`UPDATE ... WHERE sent_at IS NULL RETURNING id`) and only text if the claim succeeds. | A slow run overlapping a manual dashboard trigger, or a mid-batch crash, sends the same text 2+ times. Duplicate robotexts read as spam and drive STOP replies. |
| **Implement quiet hours** — `shared/iata_to_tz.ts` is dead code | From: the timezone map for "no texts 9pm–9am" exists but is imported nowhere; nudges fire the instant a condition trips. To: schedule sends into the recipient's daytime window; add a send-time guard that defers (not skips) overnight rows. | Users can get Rally texts at 3am. One 2am robotext loses a whole friend group and is the fastest route to carrier spam-filtering. |
| **Handle failed sends by error type** | From: any send error either retries *forever* (nudge scheduler) or is skipped *permanently* after one hiccup (RSVP scheduler). To: permanent errors (invalid number, opted-out) → skip with a reason; transient errors → retry 2–3× then stop. | Today a few bad numbers can silently freeze *all* nudges (the scheduler looks "green" while re-failing dead rows), or a real member silently drops out of reminders after one Twilio blip. |
| **Fix the recipient rate-limit blind spot** — `web/lib/blasts/rate-limits.ts` | From: the "max 2 texts per person per 24h" guard only counts web-sent texts; the high-volume edge-function texts are logged under a different column, so it can't see them. To: count both rails (match on the recipient-keyed thread id). | The one guard against carpet-texting a person can't see most of Rally's texts — so people can get 4+ in a day. |
| **Stop nudging after the deadline / after answering** | From: cadence rows scheduled past the response deadline still fire; a couple of correctness bugs around matching who already responded. To: drop cadence items past the due date; harden the "already responded" match. | Members get asked to weigh in on decisions that are already locked — "you told me the survey closed yesterday." |
| **Fix planner alert links** — `sms-trip-finalize-prompt` | From: the "come finalize your trip" texts deep-link to `rally://` (the *paused* mobile app — does nothing when tapped) and one can falsely claim "everyone's responded." To: link to the web dashboard; branch the copy by trigger. | The two highest-leverage planner texts contain a dead link and can state something untrue. |
| **Expand STOP keywords + test opt-out** — `_sms-shared/inbound-processor.ts` | From: opt-out handles a narrow keyword set and has zero tests, despite a ready-made test harness sitting unused. To: add Twilio-standard words (STOPALL, CANCEL, END, QUIT) and write the first opt-out test. | Opt-out is the one SMS behavior with legal teeth (TCPA). If a refactor breaks it, Rally keeps texting people who said stop — fines-and-blacklisting territory. |

---

## Tier 4 — Database privacy holes (same root cause as 1.2)

The public key is RLS-bound, but several tables have rules like `USING (true)` / `with check (true)` — i.e. anyone with the public key (it's in the JS bundle) can read or write them across all trips.

- **Guest rows (`respondents`) are anyone-writable** — `001_initial.sql`: a stranger can rewrite a member's phone/email (misdirecting your SMS) or inject fake guests. *Fix:* drop the `using(true)` write policies; legitimate writes already flow through service-role routes.
- **Poll votes are anyone-writable/deletable** — `001_initial.sql`: the group's destination/date decision can be silently rigged or erased. *Fix:* route vote writes through a token-validated DB function (pattern already exists in migration 077).
- **Legacy Phase-2 tables (expenses, chat, itinerary) are world-readable/writable** — `004_phase2.sql`. *Fix:* scope to trip membership or move behind service-role/DB functions.
- **Activity-feed content leaks across trips** — `120_...activity_feed_entries.sql`: comments/photos/GIFs on any trip are readable by anyone, not just people with that trip's link. *Fix:* read via a share-token-scoped DB function.
- **(Related UX bug)** The invite page assumes anonymous visitors can read the guest list, but no RLS rule allows it — so a logged-out invitee likely sees an **empty** "who's coming" list, undercutting the social proof that drives joins. *Fix:* serve the guest list via a service-role route or token-scoped function.

---

## Tier 5 — Correctness bugs (verified by me directly after the agent budget ran out)

- **Date validation is bypassable** — `web/app/api/trips/[id]/route.ts`: the "end can't be before start" check only runs when *both* dates arrive in one request. Inline editors send one date at a time, so you can set a start date after the end date. *Fix:* validate against the trip's existing dates, not just the incoming pair.
- **The following were flagged but their automated verification was cut off by the spend limit — I've spot-checked the top ones as real, but the rest are *probable, pending confirmation* before I'd act on them:** cohosts may 404 on trip pages fetched via the RLS client (the trips read rule includes creators and members but *not* cohosts); custom invite-note tokens aren't substituted; un-toggling an itinerary vote has no server path; RSVP profile-capture dead-ends on the airport step; `/user/[id]` files in-progress trips under "Past" and computes "today" in server UTC; blast composer counts guests the server later excludes; an avatar save keyed only on phone can silently revert. I recommend a short second verification pass on these before fixing.

---

## Tier 6 — Process & testing (cheap, high-leverage)

- **No automated checks run before deploy** — no CI, no git hooks; `typecheck`/`lint` scripts exist but nothing calls them. The only gate is the Netlify release build, which per your cost rule runs only on promotion. Type errors have already landed on `main` this way. *Fix:* one pre-push hook or free GitHub Action running exactly `npm run typecheck` and `deno test`. This is the highest return-on-effort item in the whole review.
- **The only test suite can't be run as documented** — there's no `deno.json` under `supabase/`, so plain `deno test` errors out. *Fix:* add `supabase/functions/deno.json` with `{ "nodeModulesDir": "none" }`.
- **The riskiest logic is untested:** `computeCadence`/`deriveResponsesDue` (when everyone gets texted), `normalizePhone` (duplicated in two files; if they drift, opt-outs stop matching), and the web personalizer (already diverged — `[BookBy]` renders on web but goes out as literal text on SMS). *Fix:* ~8 targeted tests on these specific functions — not blanket coverage.

---

## Tier 7 — Maintainability (for a codebase built fast by many AI sessions)

- **Guest-identity resolution is copy-pasted across ~8 API routes** with divergent fallbacks/error codes — the same guest action behaves differently per screen. *Fix:* one `resolveRespondent()` helper.
- **The same fetch/try-catch block is pasted 35 times across 17 components.** *Fix:* one `apiFetch<T>()` client helper.
- **Date formatting is re-implemented in 8+ files** and copies have drifted. *Fix:* one shared formatter.
- **Oversized files with clean seams:** `travel-tab.tsx` (1,094 lines), `settings-modal.tsx` (663), `activity-section.tsx` (649) — split along existing component boundaries; `travel-tab` also bypasses the shared generation-loading system the other AI tabs use.
- **Dead code:** unused `flightShareNote` export, `EffectCategory`, duplicated private `safeJson` copies, and a duplicated Gemini model-fallback list that will break one surface when the other is fixed.

---

## What I checked and *dismissed* (so you don't chase ghosts)

- **"Production build is broken by two TypeScript errors"** — **false today.** I ran both `tsc --noEmit` and `next build`: exit 0, clean. Either already fixed or never valid on this tree.
- One SMS finding ("editing the book-by date kills the nudge cadence forever") was **refuted** by a skeptic: the individual code observations were accurate but the failure doesn't actually occur end-to-end.

## Honest caveat on completeness

The review's verification phase and its final "what did we miss?" critic were cut off when the agent budget hit a hard limit. The 49 findings above **passed** verification (high-severity items by 3 independent skeptics); I then manually re-verified the flagship items myself. But ~22 correctness/quality findings (mostly the `correctness-web` pass) were *never verified* rather than refuted — I've surfaced the credible ones in Tier 5 as "pending." A short follow-up pass would close that gap. Areas nobody deeply examined: accessibility, `web/lib/effects`, the ICS calendar feed, and whether any error monitoring (Sentry) exists at all.

---

## Recommended signoff sequence

1. **Batch A — Launch blockers (Tier 1).** Do before onboarding anyone off the whitelist. 1.1, 1.2, 1.3, 1.4, 1.6 especially. Note: RLS/migration fixes (1.2, Tier 4) must be **additive** per your schema rule and need your explicit go-ahead before I run any migration.
2. **Batch B — Money leaks (Tier 2).** Quick wins, directly protects your card. The AI rate-limit + Places fixes have the best effort-to-savings ratio.
3. **Batch C — SMS reliability + the CI hook (Tier 3 + Tier 6 CI).** Protects your Twilio number's reputation and your users' patience; the CI hook prevents regressions in all the above.
4. **Batch D — Remaining correctness + maintainability (Tier 5, 7).** After a short second verification pass on the "pending" items.
