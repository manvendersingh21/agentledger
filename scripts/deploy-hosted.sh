#!/usr/bin/env bash
# Deploy AgentLedger backend to a hosted Supabase project (migrations, seeds, secrets, edge functions).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    -h | --help)
      cat <<'EOF'
Usage: ./scripts/deploy-hosted.sh [--dry-run]

Environment (required):
  SUPABASE_PROJECT_REF     Hosted project ref (20-char id)
  SUPABASE_DB_PASSWORD     Database password for link / db push
  SUPABASE_ACCESS_TOKEN    Supabase access token (Management API); not echoed

For secrets and edge functions (required on real deploy):
  STRIPE_SECRET_KEY        Stripe test secret (sk_test_ / rk_test_)
  JEV_API_KEY              Jev (TypeSafe) API key
  PAYMENT_PROVIDER         stripe | demo (defaults to stripe if unset)

Optional:
  SUPABASE_TELEMETRY_DISABLED=1

With --dry-run, prints the commands that would run without executing them.
EOF
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg (try --help)" >&2
      exit 1
      ;;
  esac
done

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required environment variable: $name" >&2
    exit 1
  fi
}

require_env SUPABASE_PROJECT_REF
require_env SUPABASE_DB_PASSWORD
require_env SUPABASE_ACCESS_TOKEN

export SUPABASE_ACCESS_TOKEN
export SUPABASE_TELEMETRY_DISABLED="${SUPABASE_TELEMETRY_DISABLED:-1}"

SUPABASE=(pnpm exec supabase)
PROJECT_REF="$SUPABASE_PROJECT_REF"
MCP_URL="https://${PROJECT_REF}.supabase.co/functions/v1/mcp"

cli_has_db_execute() {
  "${SUPABASE[@]}" db --help 2>/dev/null | grep -qE '^\s+execute\s'
}

cli_has_db_query() {
  "${SUPABASE[@]}" db --help 2>/dev/null | grep -qE '^\s+query\s'
}

run() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    printf '+'
    printf ' %q' "$@"
    printf '\n'
  else
    "$@"
  fi
}

run_link() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "+ ${SUPABASE[*]} link --project-ref ${PROJECT_REF} --password '<from env>' --yes"
  else
    run "${SUPABASE[@]}" link --project-ref "$PROJECT_REF" --password "$SUPABASE_DB_PASSWORD" --yes
  fi
}

run_db_push() {
  run "${SUPABASE[@]}" db push --linked --yes
}

run_seed_file() {
  local file="$1"
  if cli_has_db_execute; then
    run "${SUPABASE[@]}" db execute --linked -f "$file" --yes
  elif cli_has_db_query; then
    run "${SUPABASE[@]}" db query --linked -f "$file" --yes
  else
    echo "This Supabase CLI has neither 'db execute' nor 'db query'." >&2
    echo "Apply seeds manually in the Supabase SQL Editor:" >&2
    echo "  1. $ROOT/supabase/seed.sql" >&2
    echo "  2. $ROOT/supabase/seed-fixtures.sql" >&2
    exit 1
  fi
}

payment_provider="${PAYMENT_PROVIDER:-stripe}"

run_secrets() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "+ ${SUPABASE[*]} secrets set STRIPE_SECRET_KEY='<from env>' JEV_API_KEY='<from env>' PAYMENT_PROVIDER=${payment_provider}"
  else
    require_env STRIPE_SECRET_KEY
    require_env JEV_API_KEY
    run "${SUPABASE[@]}" secrets set \
      "STRIPE_SECRET_KEY=${STRIPE_SECRET_KEY}" \
      "JEV_API_KEY=${JEV_API_KEY}" \
      "PAYMENT_PROVIDER=${payment_provider}"
  fi
}

run_functions() {
  run "${SUPABASE[@]}" functions deploy mcp --no-verify-jwt
  run "${SUPABASE[@]}" functions deploy stripe-webhook --no-verify-jwt
}

print_next_steps() {
  cat <<EOF

Deploy complete (or dry-run plan printed above).

MCP endpoint:
  ${MCP_URL}

Next steps:
  1. Supabase Dashboard → Authentication → URL configuration
     - Site URL: your Vercel app URL (e.g. https://your-app.vercel.app)
     - Redirect URLs: same origin + /oauth/consent (and any local dev URLs you use)
  2. Authentication → OAuth Server: enable OAuth server and dynamic client registration (for MCP clients).
  3. Vercel: set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY,
     NEXT_PUBLIC_APP_URL, STRIPE_SECRET_KEY, JEV_API_KEY, PAYMENT_PROVIDER (see docs/DEPLOY.md).
  4. Stripe Dashboard (test mode): webhook endpoint
     https://${PROJECT_REF}.supabase.co/functions/v1/stripe-webhook
  5. Connect an MCP client:
     claude mcp add --transport http agentledger ${MCP_URL}
     (Cursor: add the same URL as an HTTP MCP server; authenticate via Supabase OAuth.)

EOF
}

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "=== deploy-hosted.sh dry-run (commands only) ==="
fi

run_link
run_db_push
run_seed_file supabase/seed.sql
run_seed_file supabase/seed-fixtures.sql
run_secrets
run_functions
print_next_steps
