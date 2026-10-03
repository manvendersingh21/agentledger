#!/usr/bin/env bash
# Push production environment variables to a linked Vercel project from .env.local.
# Secrets are never printed; values are passed to the Vercel CLI via stdin.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

DRY_RUN=0
PROD_URL=""

usage() {
  cat <<'EOF'
Usage: ./scripts/vercel-env.sh [--dry-run] <production-app-url>

Reads .env.local (never echoed) and sets Vercel Production env vars on the linked project.

Mappings:
  NEXT_PUBLIC_SUPABASE_URL              <- SUPABASE_HOSTED_URL
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY  <- SUPABASE_HOSTED_PUBLISHABLE_KEY
  SUPABASE_SECRET_KEY                   <- SUPABASE_HOSTED_API_KEY
  NEXT_PUBLIC_APP_URL                   <- first argument (production URL)

Copied as-is when present in .env.local:
  OPENAI_API_KEY, STRIPE_SECRET_KEY, JEV_API_KEY, AGENT_MODEL,
  PAYMENT_PROVIDER, NEXT_PUBLIC_DEMO_MODE

Requires: .vercel/ from `npx vercel link`, and .env.local with hosted Supabase keys.

--dry-run  Print target variable names only (no Vercel API calls).
EOF
}

for arg in "$@"; do
  case "$arg" in
    --dry-run)
      DRY_RUN=1
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      if [[ -n "$PROD_URL" ]]; then
        echo "Unexpected argument: $arg (try --help)" >&2
        exit 1
      fi
      PROD_URL="$arg"
      ;;
  esac
done

if [[ -z "$PROD_URL" ]]; then
  usage >&2
  exit 1
fi

if [[ ! -d .vercel ]]; then
  echo "No .vercel directory — link the project first: npx vercel link" >&2
  exit 1
fi

ENV_FILE="$ROOT/.env.local"
if [[ ! -f "$ENV_FILE" ]]; then
  echo ".env.local not found (copy from .env.example)" >&2
  exit 1
fi

# Load a single key from .env.local into REPLY (value may be empty).
get_env_local() {
  local key="$1"
  REPLY=""
  local line k v
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%%#*}"
    line="${line#"${line%%[![:space:]]*}"}"
    [[ -n "$line" ]] || continue
    if [[ "$line" != *"="* ]]; then
      continue
    fi
    k="${line%%=*}"
    k="${k%"${k##*[![:space:]]}"}"
    [[ "$k" == "$key" ]] || continue
    v="${line#*=}"
    v="${v#"${v%%[![:space:]]*}"}"
    if [[ ${#v} -ge 2 && "${v:0:1}" == '"' && "${v: -1}" == '"' ]]; then
      v="${v:1:${#v}-2}"
    elif [[ ${#v} -ge 2 && "${v:0:1}" == "'" && "${v: -1}" == "'" ]]; then
      v="${v:1:${#v}-2}"
    fi
    REPLY="$v"
    return 0
  done <"$ENV_FILE"
  return 1
}

require_env_local() {
  local key="$1"
  if ! get_env_local "$key"; then
    echo "Missing $key in .env.local" >&2
    exit 1
  fi
  if [[ -z "$REPLY" ]]; then
    echo "Empty $key in .env.local" >&2
    exit 1
  fi
}

push_var() {
  local name="$1"
  local value="$2"
  local sensitive="${3:-1}"

  if [[ $DRY_RUN -eq 1 ]]; then
    echo "$name"
    return 0
  fi

  local -a args=(env add "$name" production --force --yes)
  if [[ "$sensitive" == "1" ]]; then
    args+=(--sensitive)
  fi

  printf '%s' "$value" | npx vercel "${args[@]}"
}

push_optional_copy() {
  local vercel_name="$1"
  local local_name="${2:-$vercel_name}"
  if get_env_local "$local_name" && [[ -n "$REPLY" ]]; then
    push_var "$vercel_name" "$REPLY" 1
  fi
}

require_env_local SUPABASE_HOSTED_URL
HOSTED_URL="$REPLY"
require_env_local SUPABASE_HOSTED_PUBLISHABLE_KEY
HOSTED_PUBLISHABLE="$REPLY"
require_env_local SUPABASE_HOSTED_API_KEY
HOSTED_SECRET="$REPLY"

push_var NEXT_PUBLIC_SUPABASE_URL "$HOSTED_URL" 0
push_var NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY "$HOSTED_PUBLISHABLE" 0
push_var SUPABASE_SECRET_KEY "$HOSTED_SECRET" 1
push_var NEXT_PUBLIC_APP_URL "$PROD_URL" 0

for copy_name in OPENAI_API_KEY STRIPE_SECRET_KEY JEV_API_KEY; do
  push_optional_copy "$copy_name"
done
for config_name in AGENT_MODEL PAYMENT_PROVIDER NEXT_PUBLIC_DEMO_MODE; do
  if get_env_local "$config_name" && [[ -n "$REPLY" ]]; then
    push_var "$config_name" "$REPLY" 0
  fi
done

if [[ $DRY_RUN -eq 1 ]]; then
  echo "(dry-run: no values sent to Vercel)"
else
  echo "Production env vars updated on the linked Vercel project."
fi
