#!/usr/bin/env bash
# apps/api/bruno/tests/03-concurrent-overlap-race.sh
# [F-ID: TESTS-CONCURRENT-OVERLAP-RACE-01]
# @version 1.0.0
# @changelog 1.0.0 — Fires two simultaneous POST /bookings for the same slot via backgrounded curl.
#
# Fires two POST /bookings requests for the SAME resource and time range
# at the same instant, to prove the `no_overlapping_bookings` exclusion
# constraint — not application logic — is what prevents a double booking.
# A GUI REST client cannot guarantee true concurrency; two backgrounded
# curl processes started in the same shell line can.
#
# Usage:
#   BASE_URL=http://localhost:3000/v1 \
#   STAFF_TOKEN=<jwt> \
#   TENANT_ID=<tenant-a-id> \
#   RESOURCE_ID=<resource-a-id> \
#   ./03-concurrent-overlap-race.sh

set -euo pipefail

BASE_URL="${BASE_URL:?set BASE_URL}"
STAFF_TOKEN="${STAFF_TOKEN:?set STAFF_TOKEN}"
TENANT_ID="${TENANT_ID:?set TENANT_ID}"
RESOURCE_ID="${RESOURCE_ID:?set RESOURCE_ID}"

STARTS_AT="2026-08-20T10:00:00.000Z"
ENDS_AT="2026-08-20T11:00:00.000Z"

BODY=$(cat <<JSON
{"resourceId":"${RESOURCE_ID}","startsAt":"${STARTS_AT}","endsAt":"${ENDS_AT}"}
JSON
)

fire() {
  curl -s -o "/tmp/booking-race-$1.json" -w "%{http_code}" \
    -X POST "${BASE_URL}/bookings" \
    -H "Authorization: Bearer ${STAFF_TOKEN}" \
    -H "x-tenant-id: ${TENANT_ID}" \
    -H "Content-Type: application/json" \
    -d "${BODY}" \
    > "/tmp/booking-race-$1.status" &
}

fire a
fire b
wait

STATUS_A=$(cat /tmp/booking-race-a.status)
STATUS_B=$(cat /tmp/booking-race-b.status)

echo "Request A: HTTP ${STATUS_A}"
echo "Request B: HTTP ${STATUS_B}"

ONE_OK=false
ONE_CONFLICT=false
[[ "${STATUS_A}" == "201" || "${STATUS_B}" == "201" ]] && ONE_OK=true
[[ "${STATUS_A}" == "409" || "${STATUS_B}" == "409" ]] && ONE_CONFLICT=true

if $ONE_OK && $ONE_CONFLICT; then
  echo "PASS: exactly one request succeeded, the other was rejected as a conflict."
  exit 0
else
  echo "FAIL: expected one 201 and one 409. Got A=${STATUS_A} B=${STATUS_B}."
  echo "See /tmp/booking-race-a.json and /tmp/booking-race-b.json for response bodies."
  exit 1
fi
