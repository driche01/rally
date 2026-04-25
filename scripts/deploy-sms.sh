#!/usr/bin/env bash
#
# deploy-sms.sh — type-check + deploy the sms-inbound edge function.
#
# Runs `deno check` on the entry point first so silent type errors don't
# get bundled and shipped to production. Aborts the deploy on any type
# error. Loads NVM if available.
#
# Usage:
#   ./scripts/deploy-sms.sh

set -euo pipefail

PROJECT_REF="qxpbnixvjtwckuedlrfj"
ENTRY="supabase/functions/sms-inbound/index.ts"
JOIN_ENTRY="supabase/functions/sms-join-submit/index.ts"

# Locate deno: prefer ~/.deno/bin, fall back to PATH.
DENO=""
if [ -x "$HOME/.deno/bin/deno" ]; then
  DENO="$HOME/.deno/bin/deno"
elif command -v deno >/dev/null 2>&1; then
  DENO="$(command -v deno)"
fi

if [ -z "$DENO" ]; then
  echo "warn: deno not found — skipping type check." >&2
  echo "warn: install via 'curl -fsSL https://deno.land/install.sh | sh' to enable." >&2
else
  echo "==> deno check $ENTRY"
  "$DENO" check "$ENTRY"
  echo "==> deno check $JOIN_ENTRY"
  "$DENO" check "$JOIN_ENTRY"
fi

# Ensure NVM is loaded so npx finds a recent Node.
if [ -s "$HOME/.nvm/nvm.sh" ]; then
  export NVM_DIR="$HOME/.nvm"
  # shellcheck disable=SC1091
  . "$HOME/.nvm/nvm.sh"
fi

echo "==> deploying sms-inbound to $PROJECT_REF"
npx supabase functions deploy sms-inbound --project-ref "$PROJECT_REF" --no-verify-jwt

echo "==> deploying sms-join-submit to $PROJECT_REF"
npx supabase functions deploy sms-join-submit --project-ref "$PROJECT_REF" --no-verify-jwt
