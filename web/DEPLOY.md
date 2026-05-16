# Deploying Rally (web)

The Next.js app at `/web` is the alpha-facing Rally surface.
Marketing pages on `rallysurveys.netlify.app` stay on Netlify
(separate site, separate build); this app gets its own Netlify
project pointed at `/web`.

## Branch model — `main` ≠ deploy

> **Netlify's production branch is `release`, NOT `main`.**
>
> - **`main`** is the working trunk. Every commit lands here. No
>   deploy fires on a `main` push. Cheap. Worktrees stay clean.
> - **`release`** is the deploy ref. Pushing to `release` triggers
>   exactly one Netlify build. Otherwise the branch sits still.
>
> **Ship the latest main to prod:**
>
> ```sh
> git fetch origin
> git push origin origin/main:release
> ```
>
> That's the only command that costs a build. Netlify auto-builds
> + auto-publishes whatever is at `release` HEAD.
>
> **Rollback** — push the last-good `main` commit to `release`:
>
> ```sh
> git push origin <good-sha>:release --force-with-lease
> ```
>
> No `release`-branch checkouts are needed locally — everything
> goes through `git push origin <ref>:release`.

## Trunk-only on origin

Origin should have exactly three branches at rest:

- **`main`** — trunk
- **`release`** — deploy ref
- Plus your **local** working branch on whatever machine you're on,
  which exists only locally. Don't push it to origin.

Do work on a local branch, push the diff straight to `main`:

```sh
git push origin <local-branch>:main
```

No `feature/*`, `chore/*`, or `claude/*` branches should accumulate
on the remote. We swept 11 orphaned ones on 2026-05-16; don't be the
session that starts the proliferation again.

## Hard rule — team

> **Rally Netlify projects MUST live under the personal `driche01`
> Netlify team:** https://app.netlify.com/teams/driche01/projects
>
> They MUST NOT live under `cypress-health` (or any other work team).
> The Rally repo is personal; deploying to a work team conflates
> personal infra with the day job's billing + ownership.
>
> Before running ANY `netlify init` / `netlify sites:create` /
> `netlify deploy --create-site`, **confirm the active team**:
>
> ```sh
> netlify status                # check "Teams:" line
> netlify api listAccountsForUser  # full team list
> ```
>
> If the active CLI session isn't on `driche01`, do **NOT** create
> the site. Run `netlify logout && netlify login` and sign in with
> the `driche01@gmail.com` account first.

## One-time setup

1. Sign into the right account:

   ```sh
   netlify status                  # confirm: Teams: driche01
   # if it shows cypress-health or anything else:
   netlify logout
   netlify login                   # browser prompt → sign in as driche01@gmail.com
   netlify status                  # re-verify
   ```

2. Create the site (only after step 1 passes):

   ```sh
   cd web
   netlify sites:create --name rally-web --account-slug driche01
   netlify link --id <new-site-id-from-output>
   ```

   Or `netlify init` interactively — when it asks "Team", pick
   `driche01`.

   Don't link to the existing `rallysurveys` project; that's the
   Expo marketing site under a different team.

Netlify writes `.netlify/state.json` with the new site ID.
Don't commit it (already in `.gitignore`).

## Environment variables (set in Netlify dashboard)

Project Settings → Environment Variables. Mirror
`.env.local.example`:

| Key | Scope | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | All | `https://qxpbnixvjtwckuedlrfj.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | All | from Supabase dashboard |
| `SUPABASE_SERVICE_ROLE_KEY` | Production | **server-only**, never NEXT_PUBLIC_ |
| `NEXT_PUBLIC_SITE_URL` | Production | the deployed origin (`https://rally-web.netlify.app` or your custom domain) |
| `TWILIO_ACCOUNT_SID` | Production | Twilio console |
| `TWILIO_AUTH_TOKEN` | Production | Twilio console |
| `TWILIO_PHONE_NUMBER` | Production | Rally Twilio number |
| `GEMINI_API_KEY` | Production | Google AI Studio |
| `ANTHROPIC_API_KEY` | Production | Anthropic console |
| `GIPHY_API_KEY` | Production (optional) | unset → GIF picker shows "not configured" |

The non-public keys MUST NOT have the `NEXT_PUBLIC_` prefix —
Netlify embeds anything prefixed that way in the client bundle.

## Every deploy

```sh
cd web
netlify deploy --prod --build --functions=.netlify/functions-internal
```

- `--build` runs `next build` first.
- `--prod` promotes the result to the live site.
- `--functions=.netlify/functions-internal` is **required for the
  manual CLI deploy** — the Next.js plugin writes its SSR handler
  there, and the CLI doesn't pick it up automatically without the
  flag. Without it, every route 404s. (Git-based auto-deploy via the
  Netlify dashboard wires this automatically — see the next section.)

For a preview (without going to prod):

```sh
netlify deploy --build --functions=.netlify/functions-internal
```

## Auto-deploy from GitHub (recommended next step)

Netlify dashboard → Project → Site configuration → Build & deploy
→ Continuous deployment → Link to a Git repository.

- **Repository:** the Rally repo.
- **Base directory:** `web`
- **Branch to deploy:** `main`
- **Build settings:** auto-detected from `web/netlify.toml`.

After that every push to `main` ships to prod; PR branches get
auto-preview URLs.

## Smoke-test after deploy

```sh
PROD=https://rally-web.netlify.app   # swap for your actual URL

curl -sS -o /dev/null -w "/             %{http_code}\n" "$PROD/"
curl -sS -o /dev/null -w "/login        %{http_code}\n" "$PROD/login"
curl -sS -o /dev/null -w "/trips        %{http_code}\n" "$PROD/trips"
curl -sS -o /dev/null -w "whoami        %{http_code}\n" "$PROD/api/account/whoami"
curl -sS -o /dev/null -w "gifs (unset)  %{http_code}\n" "$PROD/api/gifs/search?q=hi"
```

Expected:
- `/` → `200` (anon landing)
- `/login` → `200`
- `/trips` → `307` (redirects to `/login` for anon)
- `whoami` → `401` (no session)
- `gifs` → `503` if `GIPHY_API_KEY` is unset, else `200`

Then open `$PROD` on your phone, OTP in, walk the flows.

## Custom domain (later)

Netlify dashboard → Project → Domain management → Add custom domain.
Follow Netlify's DNS instructions, then bump
`NEXT_PUBLIC_SITE_URL` to the new origin and redeploy so
server-rendered share links pick it up.

## Rollback

Netlify dashboard → Deploys → click any prior deploy → "Publish
deploy". Instant; no rebuild needed.
