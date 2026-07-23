#!/bin/sh
set -eu

for required in ADMIN_KEY DOWNLOAD_GRANT_SECRET CLEANUP_KEY; do
  eval "value=\${$required:-}"
  if [ -z "$value" ]; then
    echo "$required must be set in production" >&2
    exit 1
  fi
done

exec "$@"
