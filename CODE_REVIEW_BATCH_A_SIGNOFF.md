# Batch A — Launch-Blocker Fixes: Implementation & Signoff

_Companion to `CODE_REVIEW_2026-07-08.md`. Covers the Tier 1 fixes you approved. Nothing here touches the database; the one DB change (1.2) is prepared for your signoff, not applied._

## Integration note (what actually shipped to `main`)

This worktree was based on a stale `main`; `origin/main` had advanced by 3 commits (`6f9645d` travel-collab, `dba3323` DraftGuard, `38346b4` the same build fix). The Batch A work was therefore re-integrated cleanly onto current `origin/main` rather than force-pushed. Net effect on `main`:

- **Shipped:** 1.1 (account takeover), 1.4 (webhook signatures), 1.6 (broken reminders), and the 1.2 web halves (invite pages → service-role). Migration 152 committed, not applied.
- **Dropped as redundant:** the build fixes (§0) — `origin/main` already fixed both in `38346b4`.
- **Not needed on `main`:** the 1.3 PII fix. `origin/main` refactored the invite page so the crew list renders in a **server-side** `GuestRoster` sub-component (not a `"use client"` component), so respondent rows are used only during server render and never serialize to the client. The leak my original `PublicRespondent` fix addressed does not exist on `main`. (My crew-section approach was left in the stale-base branch, not applied.)
- **Left in the `claude/awesome-swartz-1adf18` branch (commit `e93c959`):** the in-progress avatar/crew WIP, for you to reconcile against `main`'s newer invite-tabs structure separately.


## Verification baseline (all passing after the changes below)

- `cd web && npx tsc --noEmit` — **clean** (0 errors), after deleting a stale `tsconfig.tsbuildinfo` that had been masking real errors.
- `deno check` on all four changed edge functions — **clean**.
- `cd supabase/functions && deno test --node-modules-dir=none _sms-shared/` — **81 passed, 0 failed**.

> ⚠️ **Important correction to the review.** In `CODE_REVIEW_2026-07-08.md` I marked "production build is broken: two TypeScript errors" as *refuted*, because `tsc` and `next build` returned exit 0. That was wrong — the green result came from a **stale incremental `tsconfig.tsbuildinfo` cache**. A fresh non-incremental `tsc` confirmed both errors were real and committed. I've fixed them (see 0. below). This is a live demonstration of finding #43: nothing runs typecheck automatically, so real errors sit undiscovered until the release build.

---

## 0. Pre-existing build errors (fixed — precondition for shipping anything)

Two committed TypeScript errors were failing a clean build. They predate this review (from the destination-autocomplete WIP) and aren't caused by the security work, but a red build blocks deploying all of Batch A, so I fixed them.

- **`web/app/trips/[id]/layout.tsx:190`** — the desktop-copy `<EditableTripHeader initial={{…}}>` was missing `destination_address` / `destination_place_id` (the sibling header at line 142 had them; copy-paste drift). **From:** object omits the two fields the `HeaderFields` type now requires → type error. **To:** pass `trip.destination_address` and `trip.destination_place_id` (both already selected and typed on `trip`).
- **`web/lib/ui/places-autocomplete-input.tsx:122`** — `handleSelect(suggestions[0])` where `suggestions[0]` is `PlaceSuggestion | undefined` under strict index access. **From:** unchecked index passed to a non-optional param. **To:** `const first = suggestions[0]; if (first) handleSelect(first)`.

**Impact:** the release build (`push origin main:release`) would have failed on these. Now green.

---

## 1.1 Account takeover via RSVP → promote  ✅ implemented

**Files:** `web/app/api/account/promote-from-session/route.ts`, `web/lib/brand/respondent-actions.tsx`

- **From:** if a profile already existed for the self-typed RSVP phone, `promote-from-session` reused that account and minted a login for it — so knowing a victim's phone + any invite link let an attacker log in as the victim.
- **To:** promotion may only ever mint/reuse the **synthetic cookie-only tier** (`rally-<digits>@invalid.local`). If a **real** account exists for the phone, the endpoint now returns `409 account_exists` and the client redirects to `/login` (phone-OTP), which authoritatively proves possession of the number via an SMS code — the same gate the legitimate login path uses. Added an `isSyntheticEmail()` helper and refreshed the header security note.
- **Impact:** closes the full account-takeover path. Legitimate cookie-only respondents (never registered) still get promoted seamlessly; anyone whose phone maps to a real account is routed to proper OTP login instead of being impersonated.
- **Residual (accepted, documented):** squatting an *as-yet-unregistered* phone with a synthetic account remains an accepted alpha tradeoff; the real owner reclaims it via OTP signup. Unchanged from before.

## 1.3 Guest PII leaking into the public invite page source  ✅ implemented

**Files:** `web/app/invite/[token]/page.tsx`, `crew-section.tsx`, `crew-browser-modal.tsx`

- **From:** the page fetched respondents with `select("*")` and passed full rows to client components, serializing every guest's **phone, email, and session_token** (the RSVP identity credential) into the page's HTML source.
- **To:** introduced a `PublicRespondent` type (`id, name, rsvp_status, user_id, avatar_url` only) exported from `crew-section.tsx`; the page now projects to that shape before handing anything to the client components. The session-token match for "this is me" stays server-side. Verified both crew components only ever used those five fields.
- **Impact:** view-source on an invite link no longer exposes phone numbers or the tokens that allow RSVP/comment impersonation.

## 1.4 Forgeable Twilio webhooks  ✅ implemented

**Files:** `supabase/functions/sms-inbound/index.ts`, `sms-status-webhook/index.ts`, `_sms-shared/twilio.ts`

- **From:** both webhooks only validated the signature `if (twilioAuthToken && signature)` — omitting the `X-Twilio-Signature` header skipped validation entirely, so anyone with the public URL could forge inbound "STOP" messages (mass-unsubscribe users) and fake delivery statuses. The signature compare also used `===` (not constant-time) despite a comment claiming otherwise.
- **To:** when `TWILIO_AUTH_TOKEN` is set (prod), a signature is now **mandatory** — a missing header returns `403` before any DB work; only the local-dev path (no token) may run unsigned. Replaced `===` with a `timingSafeEqual()` constant-time compare.
- **Impact:** the webhooks' sole authentication is now actually enforced. Forged opt-outs and delivery-status spoofing are blocked.

## 1.6 Broken Phase-C reminder SMS (no name/trip/link)  ✅ implemented

**Files:** `supabase/functions/sms-rsvp-nudge-scheduler/index.ts`

- **From:** the queue-drain pass called `personalizeBody` with keys `{ Name, Trip, Destination, 'Survey link' }` that don't exist on `PersonalizeContext`, so every reminder shipped with `[Name]→"there"`, `[Trip]→"the trip"`, no destination, and **no survey link** (the `surveyUrl` was never supplied, so the `[Survey link]` token never expanded).
- **To:** pass the correct fields `{ recipientName, tripName, destination, surveyUrl }`. Removed the now-dead local `firstName()` helper (`personalizeBody` extracts the first name itself).
- **Impact:** automated RSVP reminders now contain the recipient's name, trip name, and a tappable invite link. (Recommend the follow-up test named in finding 1.6 asserting a real link + name appear.)

---

## 1.2 The "secret link" isn't enforced by the database  ⏳ prepared for signoff — NOT applied

This is the one Batch A item that requires a **migration**, so per hard rule #3 it is not applied. It's an atomic change: **one migration + two one-line web edits, deployed together.** Applying only the migration would break the public invite page; applying only the web edits leaves the hole open. Nothing has been changed in the tree for 1.2.

### Current state (see `SCHEMA_REPORT.md` note below)
`trips` has an RLS policy `"Unauthenticated users can read trips via share link" USING (auth.role() = 'anon')` (migration 013, untouched by 016). It grants **every anonymous caller SELECT on every trip row** — the share-token filter exists only in app code. Because the browser uses the RLS-bound publishable key, anyone can script `supabase.from('trips').select('*')` and dump all trips + their private share links.

I verified: (a) every `from("trips")` read is a **server component**; (b) the only two **anon** reads are the two invite server pages; (c) the sole realtime subscription is on the activity feed, not `trips` — so dropping the anon `trips` policy has no realtime impact.

### Proposed migration (additive-safe: removes an over-permissive policy; touches no columns)

```sql
-- 152_trip_share_token_rls.sql
-- Close the anon "read every trip" hole. The public invite page reads
-- trips server-side and is switched to the service-role client in the
-- same change, so anon no longer needs table-level SELECT on trips.
DROP POLICY IF EXISTS "Unauthenticated users can read trips via share link" ON trips;
-- Authenticated policy ("Authenticated users can read their own trips",
-- creator OR member, from migration 016) is retained unchanged.
```

### Paired web edits (ship in the same commit as the migration)

```
web/app/invite/[token]/page.tsx:36       const anon = await createClient();      →  const svc = createServiceClient();  (and use svc for the trip read)
web/app/invite/[token]/rsvp/page.tsx:32  const anon = await createClient();      →  const svc = createServiceClient();  (trip read only)
```
Both are server components, so service-role stays server-side. The trip read remains scoped by `.eq("share_token", token)`.

### Risk checklist before applying
- [ ] Re-confirm against **live** `pg_policies` that no other anon-role SELECT policy on `trips` exists and prod matches migration history.
- [ ] Confirm no other logged-out surface reads `trips` via the anon key (grep verified none in `web/` today).
- [ ] Smoke-test a logged-out visit to `/invite/<token>` after applying: trip loads, RSVP works, activity feed loads.

### Related, NOT in this migration (Tier 4 — recommend same cycle)
`respondents` (anon write `USING/CHECK (true)`), `poll_responses` (anon vote write), legacy Phase-2 tables (`USING (true)`), and `activity_feed_entries` (not trip-scoped) share this root cause. They warrant a companion migration + a SECURITY-DEFINER-RPC read pattern, but each has its own consumer/realtime considerations and should be scoped and tested deliberately. Fixing the crew-list read (finding #21) naturally falls out of switching the invite page's `respondents` read to service-role.

---

## What I recommend next
1. **Sign off 1.2** (the migration + two web edits) so the trip-dump hole closes. I'll apply after your go-ahead and run the smoke test.
2. The rest of Batch A (0, 1.1, 1.3, 1.4, 1.6) is implemented and verified — ready to commit whenever you want.
3. Consider pulling finding #42/#43 (the CI hook + `deno.json` fix) forward from Batch C, since this session proved the "no automatic typecheck" gap is actively hiding real errors.
