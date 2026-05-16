# Rally v1 alpha — readiness snapshot

State of the worktree as of the alpha-prep close-out (post-backlog
batch). What ships, what's worth eyeballing on mobile, where the
obvious next-pass work lives.

**Branch:** `claude/eager-sanderson-00015d`
**Schema head:** `149` (Phase C + alpha-plus + activity v2 + realtime publication)
**Build:** `next build` from `/web` clean as of last commit.
**Deploy guide:** `web/DEPLOY.md` (Vercel-first; marketing landing
stays on Netlify).

## Feature surface (alpha)

### Identity + auth
- Phone OTP login via existing edge functions
  (`request-phone-login-otp` / `verify-phone-login-otp`).
  Whitelisted alpha cohort.
- **Soft-session promotion:** a respondent who's RSVPed via the
  invite link gets promoted to a full Supabase auth user the moment
  they click "+ New trip" or their profile chip. No second SMS step
  (backlog #3 / #11).
- Account dropdown (top-right): View profile · Settings · Sign out.
- Settings modal: change phone (OTP), sign out, delete account
  (typed-name confirmation), calendar sync.

### Trip flow
- Create trip (`/trips/new`) with cover image upload + AI cover
  generation, 18 themes across 4 chip-filtered categories
  (3×3 grid), 8 animated effects.
- Trip dashboard (`/trips/[id]`) with editable cover + header,
  tabbed nav (Overview · Itinerary · Lodging · Travel · Meals ·
  Shopping). All six tabs live.
- Trip cards on `/trips` dashboard, filtered by Upcoming / Invites /
  Hosting / Attended / All past + inline search.
- Invite + Send-blast modals with `[Name] [Planner] [Trip]
  [Destination] [BookBy]` click-to-insert legend + auto trip-link
  footer on every outbound SMS.

### Public invite (`/invite/[token]`)
- Anon-friendly RSVP flow: split first/last name capture, back
  nav with preserved answers, returning-airport pre-fill, 5-vibe
  capture, dietary + budget.
- **Activity feed v2:** comments, emoji reactions, threaded replies,
  GIF picker (Giphy), photo upload. Realtime via Supabase publication.
- Cookie-based identity threading: post once you've RSVPed, no name
  re-entry.

### Calendar sync
- Per-user ICS feed at `/api/calendar/<token>.ics`. Toggle which
  RSVPs surface (Going / Maybe / Invited) from Settings. Hosted +
  cohosted trips always included.

### Branding
- Italic Georgia serif "Rally" wordmark, dark green, no target
  mark. System-font, pixel-consistent everywhere. Marketing
  landing page already used the same spec.

## Mobile QA checklist

When you open the deployed URL on your phone, walk these flows:

- [ ] Anon landing renders — tagline + Sign in button visible
      without scroll.
- [ ] Sign-in OTP flow — code arrives, exchange works.
- [ ] `/trips` dashboard — cards render single-column,
      filter pills horizontal-scrollable.
- [ ] Create trip — date pickers usable, cover upload + AI
      generate both work.
- [ ] Theme picker — category chips fit, 3×3 grid responsive.
- [ ] Trip dashboard — sticky cover behaves; see "Known mobile gaps".
- [ ] Invite people modal — phone keyboard for phone input, send works.
- [ ] Public invite page (`/invite/<token>`) — square cover + RSVP
      buttons fit on a phone, no horizontal scroll.
- [ ] RSVP flow — split-name fields, vibe cards tappable, airport
      search returns results, back-button preserves selections.
- [ ] Activity feed — composer, reactions, reply, GIF picker, photo
      upload all work.
- [ ] Top-right account dropdown — fits on mobile, menu doesn't clip.
- [ ] Settings modal — sidebar tabs collapse to horizontal pill row
      at small viewports.

## Known mobile gaps (flag for next pass)

- **Sticky-center cover** on planner trip page uses
  `lg:sticky lg:h-[100dvh]` — only kicks in at `lg+`. On mobile
  the cover scrolls with content (intended). Spacing between cover
  and the name might feel tight on narrow viewports.
- **iOS bottom-bar occlusion** — most action buttons sit in the
  natural document flow. iOS Safari's URL bar can clip the last
  row of long forms. Consider sticky footers for destructive CTAs.
- **iOS file-input behavior** — `<input type=file accept="image/*">`
  without `capture` may not surface "Take Photo" cleanly on iOS.
  Worth re-checking once you have the actual deploy on a phone.
- **Activity feed virtualization** — currently renders all top-level
  entries. Fine at alpha scale; revisit if feeds grow past ~200 entries.

## Known scope gaps (intentional for alpha)

- **GIF picker requires `GIPHY_API_KEY`** — without it the picker
  shows "GIF search isn't configured yet". Everything else in the
  feed works.
- **Soft-session promotion** uses a synthetic email
  (`rally-<digits>@invalid.local`) as the auth.users key. Phone OTP
  reclaims the account if it gets squatted by an invite-link
  hijacker — acceptable at alpha scale, will harden post-alpha.
- **Send-blast bug from backlog (#5)** is parked — no repro from
  the user yet. Will pick up when symptoms surface in alpha.
- **Budget reframe (#10)** deferred per user direction — keep total
  min/max for v1, revisit based on alpha feedback.

## Required env vars (Vercel dashboard)

See `web/.env.local.example`. For prod, set:

| Key | Notes |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://qxpbnixvjtwckuedlrfj.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | from Supabase dashboard |
| `SUPABASE_SERVICE_ROLE_KEY` | **server-only**, never NEXT_PUBLIC_ |
| `NEXT_PUBLIC_SITE_URL` | the deployed origin |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_PHONE_NUMBER` | Twilio console |
| `GEMINI_API_KEY` | Google AI Studio |
| `ANTHROPIC_API_KEY` | Anthropic console |
| `GIPHY_API_KEY` | optional; disables GIF picker if unset |

## Deploy command

```sh
cd web
vercel --prod
```

(Run `vercel link` once first; see `web/DEPLOY.md` for the full
setup.)

## Post-deploy smoke test

```sh
PROD=https://your-deploy.vercel.app
curl -sS -o /dev/null -w "/ %{http_code}\n"          "$PROD/"
curl -sS -o /dev/null -w "/login %{http_code}\n"     "$PROD/login"
curl -sS -o /dev/null -w "/trips %{http_code}\n"     "$PROD/trips"        # 307 → /login
curl -sS -o /dev/null -w "/whoami %{http_code}\n"    "$PROD/api/account/whoami"  # 401
```

Then open `$PROD` on your phone, sign in via OTP, walk the
checklist above.
