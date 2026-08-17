#!/bin/sh
set -eu

for required in DOWNLOAD_GRANT_SECRET CLEANUP_KEY FILE_ENCRYPTION_KEY SMTP_HOST SMTP_FROM; do
  eval "value=\${$required:-}"
  if [ -z "$value" ]; then
    echo "$required must be set in production" >&2
    exit 1
  fi
done

exec "$@"
