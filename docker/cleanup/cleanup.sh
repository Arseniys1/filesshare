#!/bin/sh
set -eu

: "${CLEANUP_KEY:?CLEANUP_KEY must be set}"

while true; do
  curl --fail --silent --show-error \
    --request POST \
    --header "Authorization: Bearer ${CLEANUP_KEY}" \
    http://app:3000/api/internal/cleanup || true
  sleep 3600
done
