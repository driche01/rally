# Deploying Rally (web)

The Next.js app at `/web` is the alpha-facing Rally surface.
Marketing pages on `rallysurveys.netlify.app` stay on Netlify
(separate site, separate build); this app gets its own Netlify
project pointed at `/web`.

## One-time setup

You're (probably) already authed to Netlify via the CLI — verify
with `netlify status`. If not, `netlify login`.

From `/web`, create the new site:

```sh
cd web
netlify init
```

Answer the prompts:
- **Create & configure a new site** (don't link to the existing
  `rallysurveys` project — that's the Expo site).
- **Team:** your Netlify team.
- **Site name:** e.g. `rally-web` (becomes `rally-web.netlify.app`).
- **Build command / publish dir / Base directory** — leave at
  defaults; the `web/netlify.toml` here drives them.

Netlify writes `.netlify/state.json` with the new site ID.
Don't commit it (it's already in `.gitignore` patterns).

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
| `TENOR_API_KEY` | Production (optional) | unset → GIF picker shows "not configured" |

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
- `gifs` → `503` if `TENOR_API_KEY` is unset, else `200`

Then open `$PROD` on your phone, OTP in, walk the flows.

## Custom domain (later)

Netlify dashboard → Project → Domain management → Add custom domain.
Follow Netlify's DNS instructions, then bump
`NEXT_PUBLIC_SITE_URL` to the new origin and redeploy so
server-rendered share links pick it up.

## Rollback

Netlify dashboard → Deploys → click any prior deploy → "Publish
deploy". Instant; no rebuild needed.
