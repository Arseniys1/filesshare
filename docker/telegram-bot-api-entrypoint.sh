#!/bin/sh
set -eu

: "${TELEGRAM_API_ID:?TELEGRAM_API_ID must be set}"
: "${TELEGRAM_API_HASH:?TELEGRAM_API_HASH must be set}"

exec telegram-bot-api "$@"
