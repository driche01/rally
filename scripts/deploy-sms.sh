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
BROADCAST_ENTRY="supabase/functions/sms-broadcast/index.ts"
MEMBER_ADD_ENTRY="supabase/functions/member-add/index.ts"
MEMBER_REMOVE_ENTRY="supabase/functions/member-remove/index.ts"

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
  echo "==> deno check $BROADCAST_ENTRY"
  "$DENO" check "$BROADCAST_ENTRY"
  echo "==> deno check $MEMBER_ADD_ENTRY"
  "$DENO" check "$MEMBER_ADD_ENTRY"
  echo "==> deno check $MEMBER_REMOVE_ENTRY"
  "$DENO" check "$MEMBER_REMOVE_ENTRY"
fi

# Ensure NVM is loaded so npx finds a recent Node.
if [ -s "$HOME/.nvm/nvm.sh" ]; then
  export NVM_DIR="$HOME/.nvm"
  # shellcheck disable=SC1091
  . "$HOME/.nvm/nvm.sh"
fi

echo "==> deploying sms-inbound to $PROJECT_REF"
npx supabase functions deploy sms-inbound --project-ref "$PROJECT_REF" --no-verify-jwt

echo "==> deploying sms-broadcast to $PROJECT_REF"
npx supabase functions deploy sms-broadcast --project-ref "$PROJECT_REF"

echo "==> deploying member-add to $PROJECT_REF"
npx supabase functions deploy member-add --project-ref "$PROJECT_REF"

echo "==> deploying member-remove to $PROJECT_REF"
npx supabase functions deploy member-remove --project-ref "$PROJECT_REF"
