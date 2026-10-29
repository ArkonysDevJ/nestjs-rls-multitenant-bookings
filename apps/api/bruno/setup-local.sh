#!/usr/bin/env bash
# apps/api/bruno/setup-local.sh
#
# Prepares everything the Bruno collection needs on the LOCAL Supabase stack:
# three users (owner, staff, viewer) with random passwords, a tenant they
# belong to, a second tenant they do not belong to, a resource in each, and
# one confirmed booking in the second tenant. It then writes
# bruno/environments/local-stack.bru, which is ignored by Git because it holds
# the test credentials.
#
# It only talks to the local stack (127.0.0.1) and refuses to run otherwise.
# Every run creates fresh users and rows, so it can be repeated.
#
# Requirements: `supabase start` already running (from apps/api), Docker, Node.
# Usage (from apps/api):  bash bruno/setup-local.sh

set -euo pipefail
trap 'echo "::error::setup-local.sh failed at line $LINENO"' ERR

cd "$(dirname "$0")/.."

# The Supabase CLI is on the PATH in CI and may be an npm install locally.
if command -v supabase >/dev/null 2>&1; then
  SUPABASE=(supabase)
else
  SUPABASE=(npx --no-install supabase)
fi

STATUS_ENV="$("${SUPABASE[@]}" status -o env)"
get_var() { printf '%s\n' "$STATUS_ENV" | sed -n "s/^$1=\"\{0,1\}\([^\"]*\)\"\{0,1\}$/\1/p" | head -n 1; }

API_URL="$(get_var API_URL)"
ANON_KEY="$(get_var ANON_KEY)"
SERVICE_ROLE_KEY="$(get_var SERVICE_ROLE_KEY)"

case "$API_URL" in
  http://127.0.0.1:*|http://localhost:*) ;;
  *) echo "Refusing to run: API_URL is not a local address." >&2; exit 1 ;;
esac
[ -n "$ANON_KEY" ] && [ -n "$SERVICE_ROLE_KEY" ] || { echo "Could not read the local keys from 'supabase status'." >&2; exit 1; }

DB_CONTAINER="supabase_db_$(sed -n 's/^project_id *= *"\(.*\)"/\1/p' supabase/config.toml | head -n 1)"
psql_local() { docker exec -i "$DB_CONTAINER" psql -U postgres -At -q -v ON_ERROR_STOP=1 "$@"; }

random() { node -e "console.log(require('crypto').randomBytes($1).toString('base64url'))"; }
RUN_ID="$(random 4 | tr -dc 'a-z0-9' | head -c 6)"
OWNER_PW="$(random 18)"; STAFF_PW="$(random 18)"; VIEWER_PW="$(random 18)"
OWNER_EMAIL="owner-a-$RUN_ID@local.test"
STAFF_EMAIL="staff-a-$RUN_ID@local.test"
VIEWER_EMAIL="viewer-a-$RUN_ID@local.test"

create_user() { # email password -> user id
  curl -sS --fail-with-body -X POST "$API_URL/auth/v1/admin/users" \
    -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"$2\",\"email_confirm\":true}" \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);if(!j.id){console.error('user creation failed');process.exit(1)}console.log(j.id)})"
}

OWNER_ID="$(create_user "$OWNER_EMAIL" "$OWNER_PW")"
STAFF_ID="$(create_user "$STAFF_EMAIL" "$STAFF_PW")"
VIEWER_ID="$(create_user "$VIEWER_EMAIL" "$VIEWER_PW")"

# Resources and tenants get random v4 ids: the API validates ids as UUIDs.
IDS="$(psql_local -F ' ' <<SQL
with ta as (insert into tenants (name) values ('Local Tenant A $RUN_ID') returning id),
     tb as (insert into tenants (name) values ('Local Tenant B $RUN_ID') returning id),
     ra as (insert into resources (tenant_id, name, capacity) select id, 'Local Room A', 4 from ta returning id),
     rb as (insert into resources (tenant_id, name, capacity) select id, 'Local Room B', 2 from tb returning id),
     m as (insert into members (tenant_id, user_id, role)
           select id, '$OWNER_ID'::uuid, 'owner' from ta
           union all select id, '$STAFF_ID'::uuid, 'staff' from ta
           union all select id, '$VIEWER_ID'::uuid, 'viewer' from ta
           returning 1),
     bb as (insert into bookings (tenant_id, resource_id, created_by, starts_at, ends_at)
            select tb.id, rb.id, '$OWNER_ID'::uuid, '2033-05-01 10:00+00', '2033-05-01 11:00+00' from tb, rb
            returning id)
select (select id from ta), (select id from tb), (select id from ra), (select id from rb), (select id from bb);
SQL
)"
read -r TENANT_A TENANT_B RESOURCE_A RESOURCE_B BOOKING_B <<<"$IDS"

ENV_FILE="bruno/environments/local-stack.bru"
cat > "$ENV_FILE" <<ENV
vars {
  baseUrl: http://localhost:3000/v1
  supabaseUrl: $API_URL
  supabaseAnonKey: $ANON_KEY
  tenantAId: $TENANT_A
  tenantBId: $TENANT_B
  resourceAId: $RESOURCE_A
  resourceBId: $RESOURCE_B
  bookingBId: $BOOKING_B
  ownerAEmail: $OWNER_EMAIL
  ownerAPassword: $OWNER_PW
  staffAEmail: $STAFF_EMAIL
  staffAPassword: $STAFF_PW
  viewerAEmail: $VIEWER_EMAIL
  viewerAPassword: $VIEWER_PW
  ownerAToken:
  staffAToken:
  viewerAToken:
}
ENV

echo "Wrote $ENV_FILE (tenant A: $TENANT_A, tenant B: $TENANT_B)."
