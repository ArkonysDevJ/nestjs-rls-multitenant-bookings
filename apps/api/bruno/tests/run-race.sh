#!/usr/bin/env bash
# Runs the concurrent overlap race (03-concurrent-overlap-race.sh) against
# the local stack. It holds no credentials.
#
# By default it reads the values written by bruno/setup-local.sh from the
# git-ignored bruno/environments/local-stack.bru and signs in as the staff
# user to get a fresh token. To aim it at something else, set BASE_URL,
# STAFF_TOKEN, TENANT_ID and RESOURCE_ID yourself, for example:
#
#   BASE_URL=http://localhost:3000/v1 STAFF_TOKEN=<jwt> \
#   TENANT_ID=<tenant-a-id> RESOURCE_ID=<resource-a-id> \
#   bash bruno/tests/run-race.sh
#
# Requirements: the local stack and the API running (see "Running the tests"
# in the README) and `bash bruno/setup-local.sh` already run. Usage, from
# apps/api:  bash bruno/tests/run-race.sh

set -euo pipefail

cd "$(dirname "$0")/.."

ENV_FILE="environments/local-stack.bru"

env_value() { sed -n "s/^  $1: *\(.*\)$/\1/p" "$ENV_FILE" | head -n 1; }

if [ -z "${BASE_URL:-}" ] || [ -z "${STAFF_TOKEN:-}" ] || [ -z "${TENANT_ID:-}" ] || [ -z "${RESOURCE_ID:-}" ]; then
  [ -f "$ENV_FILE" ] || { echo "Missing $ENV_FILE: run 'bash bruno/setup-local.sh' first, or set BASE_URL, STAFF_TOKEN, TENANT_ID and RESOURCE_ID." >&2; exit 1; }

  SUPABASE_URL="$(env_value supabaseUrl)"
  case "$SUPABASE_URL" in
    http://127.0.0.1:*|http://localhost:*) ;;
    *) echo "Refusing to run: supabaseUrl in $ENV_FILE is not a local address." >&2; exit 1 ;;
  esac

  BASE_URL="${BASE_URL:-$(env_value baseUrl)}"
  TENANT_ID="${TENANT_ID:-$(env_value tenantAId)}"
  RESOURCE_ID="${RESOURCE_ID:-$(env_value resourceAId)}"

  if [ -z "${STAFF_TOKEN:-}" ]; then
    STAFF_TOKEN="$(curl -sS --fail-with-body -X POST "$SUPABASE_URL/auth/v1/token?grant_type=password" \
      -H "apikey: $(env_value supabaseAnonKey)" -H 'Content-Type: application/json' \
      -d "{\"email\":\"$(env_value staffAEmail)\",\"password\":\"$(env_value staffAPassword)\"}" \
      | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).access_token))")"
  fi
fi

export BASE_URL STAFF_TOKEN TENANT_ID RESOURCE_ID
exec bash "$(dirname "$0")/03-concurrent-overlap-race.sh"
