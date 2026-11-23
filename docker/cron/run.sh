#!/bin/sh
# Calls one cron route on the app. Non-zero exit on any HTTP error.
# Optional second argument: seconds to wait for the answer (default 60).
set -u
route="$1"
timeout="${2:-60}"
if body="$(wget -q -T "$timeout" -O - --post-data "" \
  --header "Authorization: Bearer $(cat /run/cron-secret)" \
  "http://app:3000/api/cron/$route" 2>&1)"; then
  echo "OK $route $body"
else
  echo "ERROR $route $body" >&2
  exit 1
fi
