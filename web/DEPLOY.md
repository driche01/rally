# Deploying Rally (web)

The Next.js app at `/web` is the alpha-facing Rally surface.
Marketing pages on `rallysurveys.netlify.app` stay on Netlify;
this Next.js app deploys to Vercel.

## One-time setup

1. **Install the Vercel CLI** (skip if already installed):

   ```sh
   npm i -g vercel
   ```

2. **Link the project.** From `/web`:

   ```sh
   cd web
   vercel link
   ```

   - Select your Vercel team.
   - "Link to existing project?" → No (first time).
   - Project name → `rally-web` (or whatever you prefer).
   - Directory → `./` (you're already in `/web`).
   - Vercel writes `.vercel/` with the project metadata. Don't
     commit it — it's in `.gitignore` already.

3. **Set environment variables in the Vercel dashboard** (Project
   Settings → Environment Variables). Mirror `.env.local.example`:

   | Key | Scope | Notes |
   |---|---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | Production / Preview / Dev | `https://qxpbnixvjtwckuedlrfj.supabase.co` |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Production / Preview / Dev | from Supabase dashboard |
   | `SUPABASE_SERVICE_ROLE_KEY` | **Production / Preview only** | never to client; from Supabase dashboard |
   | `NEXT_PUBLIC_SITE_URL` | Production | the deployed origin, e.g. `https://rally-web.vercel.app` |
   | `TWILIO_ACCOUNT_SID` | Production | from Twilio console |
   | `TWILIO_AUTH_TOKEN` | Production | from Twilio console |
   | `TWILIO_PHONE_NUMBER` | Production | the Rally Twilio number |
   | `GEMINI_API_KEY` | Production | Google AI Studio key |
   | `ANTHROPIC_API_KEY` | Production | Anthropic console key |
   | `TENOR_API_KEY` | Production (optional) | unset = GIF picker shows "not configured" |

   The non-public keys MUST NOT have the `NEXT_PUBLIC_` prefix — Vercel
   exposes anything prefixed that way to the browser bundle.

## Every deploy

```sh
cd web
vercel --prod
```

Vercel auto-builds (`next build`) and deploys. The first prod deploy
assigns the `rally-web-<id>.vercel.app` URL; subsequent prod deploys
overwrite it.

To preview a branch without going to prod:

```sh
vercel              # builds against this commit, returns a preview URL
```

## Auto-deploy from GitHub (recommended next step)

Connect the GitHub repo in the Vercel dashboard → "Connect Git Repository".
Set:
- **Root Directory:** `web`
- **Framework Preset:** Next.js (auto-detected)
- **Build & Output Settings:** leave at defaults
- **Production Branch:** `main`

After that, every push to `main` ships to prod; PRs get preview URLs
automatically.

## Smoke-test after deploy

```sh
PROD=https://your-deploy.vercel.app

curl -sS -o /dev/null -w "%{http_code} %{url}\n" "$PROD/"          # 200 (anon landing)
curl -sS -o /dev/null -w "%{http_code} %{url}\n" "$PROD/login"     # 200
curl -sS -o /dev/null -w "%{http_code} %{url}\n" "$PROD/trips"     # 307 → /login (anon)
curl -sS -o /dev/null -w "%{http_code} %{url}\n" "$PROD/api/account/whoami"  # 401 (anon)
curl -sS -o /dev/null -w "%{http_code} %{url}\n" "$PROD/api/gifs/search?q=hi"  # 503 if TENOR unset, else 200
```

Then open `$PROD` on your phone, sign in via OTP, walk the flows.

## Custom domain

Once you have one (e.g. `rally.com` or `try.rally.com`):

1. Vercel Project → Settings → Domains → Add.
2. Update DNS per Vercel's instructions (CNAME → `cname.vercel-dns.com`).
3. Set `NEXT_PUBLIC_SITE_URL=https://rally.com` in env vars.
4. Redeploy so server-rendered share links pick up the new origin.

## Rollback

```sh
vercel rollback <previous-deployment-url>
```

or via the Vercel dashboard → Deployments → Promote a prior one.
